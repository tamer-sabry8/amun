// Talks to Firstmate through the existing conversation service
// (native-pi "conversation" / "conversation-send"). One live conversation is
// shared by the app; each work area keeps its own visible thread in Amun.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { nativePiEvent, nativeTurnTextLimit } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import type { WaitReason } from "./held-wait.ts";
import { replyFromTranscript } from "./view-model.ts";
import { modelDisplay } from "../../../../packages/domain/src/work/shell.ts";

interface Session {
  sessionId: string;
  model: string | null;
  text: string;
  /** Whether the current model can look at an image. */
  acceptsImage: boolean;
  /** How many replies the conversation holds; a new one raises it. */
  replyCount: number | null;
}
const countOf = (result: Record<string, unknown>) =>
  typeof result.replyCount === "number" ? result.replyCount : null;
let session: Session | null = null;
const waiting = new Map<string, (result: unknown) => void>();
let listening = false;
let contextGeneration = 0;
/** Ids of sent captain turns, which Firstmate is already answering. */
const sentTurns = new Set<string>();
/**
 * Drops the conversation and settles every call still waiting on the old one.
 * With `keepTurns`, a captain turn already sent keeps waiting for its answer:
 * Firstmate is still answering it, and the answer belongs to the chat it was
 * sent from (a lost answer also loses its rename, client or question card).
 */
function resetContext(text: string, keepTurns = false) {
  contextGeneration++;
  session = null;
  priming = null;
  reading = null;
  const pending = [...waiting.entries()].filter(
    ([id]) => !(keepTurns && sentTurns.has(id)),
  );
  for (const [id] of pending) {
    waiting.delete(id);
    sentTurns.delete(id);
  }
  for (const [, done] of pending) done({ kind: "message", text });
}
function listen() {
  if (listening) return;
  listening = true;
  let product = bridge.getSnapshot().workspace?.preferences.productId ?? null;
  bridge.subscribe(() => {
    const next = bridge.getSnapshot().workspace?.preferences.productId ?? null;
    if (next === product) return;
    product = next;
    // Only a conversation that was already open is reopened; otherwise the
    // label keeps coming from the saved default and no worker is started.
    const wasOpen = !!session || !!priming || waiting.size > 0;
    resetContext(
      "The conversation changed. Read it before sending another message.",
      true,
    );
    void (wasOpen ? prime() : readSavedModel());
    for (const listener of modelListeners) listener();
  });
  bridge.onEvent((raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      "kind" in raw &&
      raw.kind === "service-lost"
    ) {
      resetContext("Connection interrupted. Try again.");
      return;
    }
    const event = nativePiEvent.safeParse(raw);
    if (!event.success) return;
    const done = waiting.get(event.data.id);
    // Dialogs and progress for the same turn are not the final result.
    if (
      !done ||
      event.data.result.kind === "extension-dialog" ||
      event.data.result.kind === "turn-queue"
    )
      return;
    waiting.delete(event.data.id);
    sentTurns.delete(event.data.id);
    done(event.data.result);
  });
}
/** The service runs one native operation at a time and refuses the rest with this text. */
const nativeBusy = "Wait for the current native operation.";
/**
 * Runs a native command. A refusal because another operation is still out
 * means the command never ran, so it is offered again rather than reported as
 * a failure: a message must not be lost because the machine was slow.
 */
async function run(command: string, argument: string) {
  const until = Date.now() + 150_000;
  for (;;) {
    const result = await runOnce(command, argument);
    if (
      result.kind !== "message" ||
      result.text !== nativeBusy ||
      Date.now() > until
    )
      return result;
    await new Promise((done) => setTimeout(done, 400));
  }
}
function runOnce(command: string, argument: string) {
  listen();
  return new Promise<{ kind: string; [key: string]: unknown }>((resolve) => {
    const id = crypto.randomUUID();
    // Opening the conversation is a read. No user turn has been dispatched yet.
    const opening = command === "conversation";
    const timer = opening
      ? setTimeout(() => {
          waiting.delete(id);
          resolve({
            kind: "message",
            text: "Firstmate did not finish opening the conversation. Your message is saved in this chat. Try sending again.",
          });
        }, 60_000)
      : undefined;
    if (command === "conversation-send") sentTurns.add(id);
    waiting.set(id, (result) => {
      clearTimeout(timer);
      resolve(result as { kind: string; [key: string]: unknown });
    });
    try {
      bridge.send({
        version: 1,
        kind: "native-pi",
        action: "run",
        id,
        command,
        argument,
      });
    } catch {
      waiting.delete(id);
      sentTurns.delete(id);
      clearTimeout(timer);
      resolve({
        kind: "message",
        text: "Amun lost its connection to Firstmate. Check the conversation before sending again.",
      });
    }
  });
}

export type Turn =
  | { ok: true; reply: string; model: string | null; followups: string[] }
  | {
      ok: false;
      reason: string;
      /** No usable AI provider: the message can wait and be sent later. */
      needsProvider: boolean;
    };

/** A submitted message waiting for dispatch in its originating chat. */
export interface Held {
  ref?: string | undefined;
  /** What the user typed, as shown in the conversation. */
  text: string;
  /** What is sent to Firstmate (may carry the work area's context). */
  scoped: string;
  /** Its Activity row, reused so repeated attempts do not add rows. */
  activityId?: string | null;
  /** One image sent with the message (base64 PNG), if any. */
  image?: string | undefined;
  /** Why it waits; missing in messages saved by older builds. */
  reason?: WaitReason | undefined;
}
const heldKey = "amun.held-messages";
const held = new Map<string, Held[]>();
try {
  for (const [areaId, value] of Object.entries(
    JSON.parse(localStorage.getItem(heldKey) ?? "{}") as Record<
      string,
      Held | Held[]
    >,
  )) {
    const queue = (Array.isArray(value) ? value : [value]).filter(
      (item) =>
        typeof item?.text === "string" && typeof item.scoped === "string",
    );
    if (queue.length) held.set(areaId, queue);
  }
} catch {
  // A damaged entry only loses the waiting state, never the message itself.
}
const queueListeners = new Set<() => void>();
export function observeHeldMessages(listener: () => void) {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}
const saveHeld = () => {
  try {
    localStorage.setItem(heldKey, JSON.stringify(Object.fromEntries(held)));
  } catch {
    // Storage is best effort; the in-memory copy still holds for this run.
  }
  for (const listener of queueListeners) listener();
};
export type TurnPhase = "starting" | "working";
export interface InFlightTurn {
  phase: TurnPhase;
  startedAt: number;
}
/** Work areas with a turn in flight, so a waiting message is never sent twice. */
export const inFlight = new Set<string>();
const inFlightMeta = new Map<string, InFlightTurn>();
const inFlightListeners = new Set<() => void>();
const notifyInFlight = () => {
  for (const listener of inFlightListeners) listener();
};
export function startInFlight(
  key: string,
  phase: TurnPhase = "starting",
  now = Date.now(),
) {
  inFlight.add(key);
  inFlightMeta.set(key, { phase, startedAt: now });
  notifyInFlight();
}
export function setInFlightPhase(key: string, phase: TurnPhase) {
  const existing = inFlightMeta.get(key);
  if (!existing || existing.phase === phase) return;
  inFlightMeta.set(key, { ...existing, phase });
  notifyInFlight();
}
export function finishInFlight(key: string) {
  inFlight.delete(key);
  inFlightMeta.delete(key);
  notifyInFlight();
}
export function inFlightState(key: string): InFlightTurn | null {
  return inFlightMeta.get(key) ?? null;
}
export function observeInFlight(listener: () => void) {
  inFlightListeners.add(listener);
  return () => {
    inFlightListeners.delete(listener);
  };
}
/** Survives navigating away from a chat and returning while Firstmate is still working. */
export function useInFlight(key: string): InFlightTurn | null {
  return useSyncExternalStore(
    observeInFlight,
    () => inFlightMeta.get(key) ?? null,
    () => null,
  );
}
/** Plain-English elapsed duration for long-running Firstmate turns (shown after 10s). */
export function formatElapsed(ms: number): string | null {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 10) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
const emptyQueue: readonly Held[] = [];
export const heldQueue = (areaId: string): readonly Held[] =>
  held.get(areaId) ?? emptyQueue;
export const heldMessage = (areaId: string) => held.get(areaId)?.[0] ?? null;
export function holdMessage(areaId: string, message: Held, front = false) {
  const queue = held.get(areaId) ?? [];
  held.set(areaId, front ? [message, ...queue] : [...queue, message]);
  saveHeld();
}
/** Removes and returns the waiting message, so it can be sent exactly once. */
export function releaseMessage(areaId: string) {
  const queue = held.get(areaId);
  const message = queue?.[0] ?? null;
  if (queue && queue.length > 1) held.set(areaId, queue.slice(1));
  else held.delete(areaId);
  saveHeld();
  return message;
}
const providerProblem =
  /sign in|signed in|no model|credential|unauthori[sz]ed|authentication|token.*expired/i;

// Which conversations have been told how to act inside Amun. A new
// conversation (after a restart, a model change or a sign-in) knows nothing
// of it, whatever the work area's own history says.
const briefed = new Set<string>();
/** True until the conversation in use has been given Amun's rules. */
export const needsBriefing = () => !session || !briefed.has(session.sessionId);
/** Records that the conversation in use has now been given them. */
export function markBriefed() {
  if (session) briefed.add(session.sessionId);
}

/** Sends one turn and returns Firstmate's reply, or a plain reason it could not. */
export async function askFirstmate(
  text: string,
  image?: string,
  onPhase?: (phase: TurnPhase) => void,
): Promise<Turn> {
  if (text.length > nativeTurnTextLimit)
    return {
      ok: false,
      needsProvider: false,
      reason:
        "This message and its attachments contain too much text for one turn. Send fewer attachments together; the originals remain in the Library.",
    };
  const generation = contextGeneration;
  const changed = (): Turn => ({
    ok: false,
    needsProvider: false,
    reason: "The conversation changed. Please send your message again.",
  });
  // The model label may already be opening the same conversation.
  if (priming) {
    onPhase?.("starting");
    await priming;
  }
  if (generation !== contextGeneration) return changed();
  if (!session) {
    onPhase?.("starting");
    const opened = await run("conversation", "");
    if (generation !== contextGeneration) return changed();
    if (opened.kind !== "conversation")
      return {
        ok: false,
        needsProvider: providerProblem.test(String(opened.text ?? "")),
        reason:
          typeof opened.text === "string" && opened.text
            ? opened.text
            : "Firstmate is not ready yet. Sign in under Settings › Accounts and models.",
      };
    session = {
      sessionId: String(opened.sessionId),
      model: (opened.model as string | null) ?? null,
      text: String(opened.text ?? ""),
      acceptsImage: opened.acceptsImage === true,
      replyCount: countOf(opened),
    };
  }
  if (!session.model) {
    // Ask again next time: a provider may have been connected since.
    session = null;
    return {
      ok: false,
      needsProvider: true,
      reason:
        "Firstmate has no model yet. Sign in under Settings › Accounts and models.",
    };
  }
  if (image && !session.acceptsImage)
    return {
      ok: false,
      needsProvider: false,
      reason:
        "The model Firstmate is using can’t look at images. Choose one that can under Accounts and models, or remove the image and send again.",
    };
  const before = session.text,
    beforeCount = session.replyCount;
  const argument = JSON.stringify({
    sessionId: session.sessionId,
    model: session.model,
    text,
    ...(image ? { image } : {}),
  });
  if (argument.length > 524288)
    return {
      ok: false,
      needsProvider: false,
      reason:
        "This message and its attachments are too large for one turn. Send the image and documents separately.",
    };
  onPhase?.("working");
  const result = await run("conversation-send", argument);
  // The turn may or may not have run before the switch: never replace the new
  // conversation with it, and never send it again on the user's behalf. An
  // answer that did arrive still belongs to the chat that sent it.
  if (generation !== contextGeneration) {
    const answered =
      result.kind === "conversation" &&
      typeof result.latestReply === "string" &&
      result.latestReply.trim()
        ? result.latestReply.trim()
        : null;
    return answered
      ? {
          ok: true,
          reply: answered,
          model: (result.model as string | null) ?? null,
          followups: Array.isArray(result.followups)
            ? result.followups.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        }
      : {
          ok: false,
          needsProvider: false,
          reason:
            "The conversation changed while this message was being sent. Read the conversation before sending it again.",
        };
  }
  if (result.kind !== "conversation") {
    const reason =
      typeof result.text === "string" && result.text
        ? result.text
        : "Firstmate could not answer.";
    const needsProvider = providerProblem.test(reason);
    if (needsProvider) session = null;
    return { ok: false, reason, needsProvider };
  }
  session = {
    sessionId: String(result.sessionId),
    model: (result.model as string | null) ?? null,
    text: String(result.text ?? ""),
    acceptsImage: result.acceptsImage === true,
    replyCount: countOf(result),
  };
  const reply =
    beforeCount !== null && session.replyCount !== null
      ? session.replyCount > beforeCount &&
        typeof result.latestReply === "string" &&
        result.latestReply.trim()
        ? result.latestReply.trim()
        : null
      : replyFromTranscript(before, session.text, text);
  return reply
    ? {
        ok: true,
        reply,
        model: session.model,
        followups: Array.isArray(result.followups)
          ? result.followups.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      }
    : {
        ok: false,
        needsProvider: false,
        reason: "Firstmate finished without a reply. Try rephrasing.",
      };
}

let priming: Promise<void> | null = null;
/** The default model read from Pi's saved settings, with no conversation open. */
let savedModel: string | null = null;
let reading: Promise<void> | null = null;
/** Reads the saved default for the prompt box; falls back to the conversation only when it cannot know. */
function readSavedModel(): Promise<void> {
  if (session || priming) return priming ?? Promise.resolve();
  if (reading) return reading;
  const generation = contextGeneration;
  reading = run("default-model", "")
    .then((result) => {
      if (generation !== contextGeneration || session) return;
      let known: { model?: unknown; needsConversation?: unknown } = {};
      try {
        known = JSON.parse(String(result.text ?? "{}")) ?? {};
      } catch {
        known = { needsConversation: true };
      }
      if (known.needsConversation === true) return prime();
      const next = typeof known.model === "string" ? known.model : null;
      if (next === savedModel) return;
      savedModel = next;
      for (const listener of modelListeners) listener();
    })
    .finally(() => {
      if (generation === contextGeneration) reading = null;
    });
  return reading;
}
/** Opens the conversation once, so the model in use is known before a message. */
function prime() {
  if (session || priming) return priming ?? Promise.resolve();
  const generation = contextGeneration;
  priming = run("conversation", "")
    .then((opened) => {
      if (
        generation === contextGeneration &&
        opened.kind === "conversation" &&
        !session
      )
        session = {
          sessionId: String(opened.sessionId),
          model: (opened.model as string | null) ?? null,
          text: String(opened.text ?? ""),
          acceptsImage: opened.acceptsImage === true,
          replyCount: countOf(opened),
        };
      if (generation === contextGeneration && session)
        for (const listener of modelListeners) listener();
    })
    .finally(() => {
      if (generation === contextGeneration) priming = null;
    });
  return priming;
}

const modelListeners = new Set<() => void>();
/** The models the signed-in providers offer, as Pi lists them. */
export async function listModels(): Promise<{ id: string; label: string }[]> {
  const generation = contextGeneration;
  await prime();
  if (generation !== contextGeneration) return [];
  const result = await run("model", "");
  if (generation !== contextGeneration) return [];
  return result.kind === "choices" && Array.isArray(result.choices)
    ? (result.choices as { id: string; label: string }[])
    : [];
}
/** Switches Firstmate to another model; true when Pi accepted it. */
export async function chooseModel(id: string): Promise<boolean> {
  const generation = contextGeneration;
  await prime();
  if (generation !== contextGeneration || !session) return false;
  const result = await run("model", id);
  if (
    generation !== contextGeneration ||
    !session ||
    result.kind !== "message" ||
    !String(result.text).includes(id)
  )
    return false;
  session = { ...session, model: id };
  // What the new model can do (look at images, for one) is the conversation's
  // to say, so it is read again rather than carried over from the old model.
  const refreshed = await run("conversation", "");
  if (generation !== contextGeneration) return false;
  if (refreshed.kind === "conversation")
    session = {
      sessionId: String(refreshed.sessionId),
      model: (refreshed.model as string | null) ?? id,
      text: String(refreshed.text ?? ""),
      acceptsImage: refreshed.acceptsImage === true,
      replyCount: countOf(refreshed),
    };
  for (const listener of modelListeners) listener();
  return true;
}
/** Listens for model changes; the label is read from saved settings, not the worker. */
export function subscribeModel(listener: () => void) {
  modelListeners.add(listener);
  void readSavedModel();
  return () => {
    modelListeners.delete(listener);
  };
}
/** The full id of the model in use, e.g. "github-copilot/claude-sonnet-5". */
export const currentModel = () => session?.model ?? savedModel;

/** The provider and model Firstmate is using, for the prompt box. */
export function useFirstmateModel() {
  const [model, setModel] = useState<string | null>(currentModel());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      if (mounted.current && currentModel() !== model) setModel(currentModel());
    };
    const timer = setInterval(() => {
      sync();
      // A sign-in elsewhere changes what the saved files say.
      if (!currentModel()) void readSavedModel();
    }, 1500);
    const unsubscribe = subscribeModel(sync);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [model]);
  return modelDisplay(model);
}
