import { nativeTurnRequest } from "../../contracts/src/native-pi.ts";
export interface NativeTurnSession {
  sessionId: string;
  model: { provider: string; id: string } | undefined;
  isStreaming: boolean;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(
    text: string,
    options: { expandPromptTemplates: false },
  ): Promise<void>;
}
/** Acknowledgement, an old assistant reply, or a provider error cannot prove this turn completed. */
export async function nativeTurn(session: NativeTurnSession, input: unknown) {
  const request = nativeTurnRequest.parse(input);
  if (
    session.isStreaming ||
    request.sessionId !== session.sessionId ||
    !session.model ||
    request.model !== session.model.provider + "/" + session.model.id
  )
    throw Error("Active conversation or model changed");
  let assistantStopped = false,
    unexpectedTool = false,
    settled = false,
    aborted = false;
  let wake!: () => void;
  const settlement = new Promise<void>((r) => {
    wake = r;
  });
  const remove = session.subscribe((raw) => {
    if (!raw || typeof raw !== "object") return;
    const e = raw as {
      type?: unknown;
      aborted?: unknown;
      message?: { role?: unknown; stopReason?: unknown; content?: unknown };
    };
    if (e.type === "tool_execution_start") unexpectedTool = true;
    if (e.type === "message_end" && e.message?.role === "assistant")
      assistantStopped =
        e.message.stopReason === "stop" &&
        Array.isArray(e.message.content) &&
        e.message.content.some(
          (p) =>
            p?.type === "text" && typeof p.text === "string" && p.text.trim(),
        );
    if (e.type === "agent_settled" && typeof e.aborted === "boolean") {
      settled = true;
      aborted = e.aborted;
      wake();
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await session.prompt(request.text, { expandPromptTemplates: false });
    if (!settled)
      await Promise.race([
        settlement,
        new Promise<void>((r) => {
          timer = setTimeout(r, 5000);
        }),
      ]);
    if (!settled || unexpectedTool) throw Error("Turn outcome unverified");
    if (aborted) return "aborted" as const;
    if (!assistantStopped) throw Error("Assistant reply not verified");
    return "completed" as const;
  } finally {
    clearTimeout(timer);
    remove();
  }
}
