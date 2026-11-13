// Talks to Firstmate through the existing conversation service
// (native-pi "conversation" / "conversation-send"). One live conversation is
// shared by the app; each work area keeps its own visible thread in Amun.
import { useEffect, useRef, useState } from "react";
import { nativePiEvent } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { replyFromTranscript } from "./view-model.ts";
import { modelDisplay } from "../../../../packages/domain/src/work/shell.ts";

interface Session {
  sessionId: string;
  model: string | null;
  text: string;
  /** Whether the current model can look at an image. */
  acceptsImage: boolean;
}
let session: Session | null = null;
const waiting = new Map<string, (result: unknown) => void>();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  bridge.onEvent((raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      "kind" in raw &&
      raw.kind === "service-lost"
    ) {
      session = null;
      for (const done of waiting.values())
        done({ kind: "message", text: "Connection interrupted. Try again." });
      waiting.clear();
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
    done(event.data.result);
  });
}
function run(command: string, argument: string) {
  listen();
  return new Promise<{ kind: string; [key: string]: unknown }>((resolve) => {
    const id = crypto.randomUUID();
    waiting.set(id, resolve as (result: unknown) => void);
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      id,
      command,
      argument,
    });
  });
}

export type Turn =
  | { ok: true; reply: string; model: string | null }
  | {
      ok: false;
      reason: string;
      /** No usable AI provider: the message can wait and be sent later. */
      needsProvider: boolean;
    };

/** One message per work area that is waiting for an AI provider. */
export interface Held {
  /** What the user typed, as shown in the conversation. */
  text: string;
  /** What is sent to Firstmate (may carry the work area's context). */
  scoped: string;
  /** Its Activity row, reused so repeated attempts do not add rows. */
  activityId?: string | null;
  /** One image sent with the message (base64 PNG), if any. */
  image?: string | undefined;
}
const heldKey = "amun.held-messages";
const held = new Map<string, Held>();
try {
  for (const [areaId, value] of Object.entries(
    JSON.parse(localStorage.getItem(heldKey) ?? "{}") as Record<string, Held>,
  ))
    if (typeof value?.text === "string" && typeof value?.scoped === "string")
      held.set(areaId, value);
} catch {
  // A damaged entry only loses the waiting state, never the message itself.
}
const saveHeld = () => {
  try {
    localStorage.setItem(heldKey, JSON.stringify(Object.fromEntries(held)));
  } catch {
    // Storage is best effort; the in-memory copy still holds for this run.
  }
};
/** Work areas with a turn in flight, so a waiting message is never sent twice. */
export const inFlight = new Set<string>();
export const heldMessage = (areaId: string) => held.get(areaId) ?? null;
export function holdMessage(areaId: string, message: Held) {
  held.set(areaId, message);
  saveHeld();
}
/** Removes and returns the waiting message, so it can be sent exactly once. */
export function releaseMessage(areaId: string) {
  const message = held.get(areaId) ?? null;
  held.delete(areaId);
  saveHeld();
  return message;
}
const providerProblem =
  /sign in|signed in|not ready|no model|could not be verified|could not be completed|reconnect|credential|unauthori[sz]ed|expired/i;

/** Sends one turn and returns Firstmate's reply, or a plain reason it could not. */
export async function askFirstmate(
  text: string,
  image?: string,
): Promise<Turn> {
  if (!session) {
    const opened = await run("conversation", "");
    if (opened.kind !== "conversation")
      return {
        ok: false,
        needsProvider: true,
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
  const before = session.text;
  const result = await run(
    "conversation-send",
    JSON.stringify({
      sessionId: session.sessionId,
      model: session.model,
      text,
      ...(image ? { image } : {}),
    }),
  );
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
  };
  const reply = replyFromTranscript(before, session.text, text);
  return reply
    ? { ok: true, reply, model: session.model }
    : {
        ok: false,
        needsProvider: false,
        reason: "Firstmate finished without a reply. Try rephrasing.",
      };
}

let priming: Promise<void> | null = null;
/** Opens the conversation once, so the model in use is known before a message. */
function prime() {
  if (session || priming) return priming ?? Promise.resolve();
  priming = run("conversation", "")
    .then((opened) => {
      if (opened.kind === "conversation" && !session)
        session = {
          sessionId: String(opened.sessionId),
          model: (opened.model as string | null) ?? null,
          text: String(opened.text ?? ""),
          acceptsImage: opened.acceptsImage === true,
        };
    })
    .finally(() => {
      priming = null;
    });
  return priming;
}

const modelListeners = new Set<() => void>();
/** The models the signed-in providers offer, as Pi lists them. */
export async function listModels(): Promise<{ id: string; label: string }[]> {
  await prime();
  const result = await run("model", "");
  return result.kind === "choices" && Array.isArray(result.choices)
    ? (result.choices as { id: string; label: string }[])
    : [];
}
/** Switches Firstmate to another model; true when Pi accepted it. */
export async function chooseModel(id: string): Promise<boolean> {
  await prime();
  if (!session) return false;
  const result = await run("model", id);
  if (result.kind !== "message" || !String(result.text).includes(id))
    return false;
  session = { ...session, model: id };
  // What the new model can do (look at images, for one) is the conversation's
  // to say, so it is read again rather than carried over from the old model.
  const refreshed = await run("conversation", "");
  if (refreshed.kind === "conversation")
    session = {
      sessionId: String(refreshed.sessionId),
      model: (refreshed.model as string | null) ?? id,
      text: String(refreshed.text ?? ""),
      acceptsImage: refreshed.acceptsImage === true,
    };
  for (const listener of modelListeners) listener();
  return true;
}
/** The full id of the model in use, e.g. "github-copilot/claude-sonnet-5". */
export const currentModel = () => session?.model ?? null;

/** The provider and model Firstmate is using, for the prompt box. */
export function useFirstmateModel() {
  const [model, setModel] = useState<string | null>(session?.model ?? null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    // Shortly after opening, so the label is right before the first message.
    const first = setTimeout(() => void prime(), 1200);
    const sync = () => {
      if (mounted.current && (session?.model ?? null) !== model)
        setModel(session?.model ?? null);
    };
    const timer = setInterval(sync, 1500);
    modelListeners.add(sync);
    return () => {
      mounted.current = false;
      clearTimeout(first);
      clearInterval(timer);
      modelListeners.delete(sync);
    };
  }, [model]);
  return modelDisplay(model);
}
