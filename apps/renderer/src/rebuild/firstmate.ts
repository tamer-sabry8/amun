// Talks to Firstmate through the existing conversation service
// (native-pi "conversation" / "conversation-send"). One live conversation is
// shared by the app; each work area keeps its own visible thread in Amun.
import { useEffect, useRef, useState } from "react";
import { nativePiEvent } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { replyFromTranscript } from "./view-model.ts";

interface Session {
  sessionId: string;
  model: string | null;
  text: string;
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
export async function askFirstmate(text: string): Promise<Turn> {
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
  const before = session.text;
  const result = await run(
    "conversation-send",
    JSON.stringify({
      sessionId: session.sessionId,
      model: session.model,
      text,
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

/** The model Firstmate last used, for the composer's routing label. */
export function useFirstmateModel() {
  const [model, setModel] = useState<string | null>(session?.model ?? null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => {
      if (mounted.current && (session?.model ?? null) !== model)
        setModel(session?.model ?? null);
    }, 1500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [model]);
  const name = model?.split("/").pop() ?? null;
  return name && name !== "unknown" ? name : null;
}
