import { nativeTurnRequest } from "../../contracts/src/native-pi.ts";
export interface NativeTurnSession {
  sessionId: string;
  model:
    { provider: string; id: string; input?: readonly string[] } | undefined;
  isStreaming: boolean;
  settingsManager?: { getBlockImages(): boolean };
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(
    text: string,
    options: {
      expandPromptTemplates: false;
      images?: { type: "image"; mimeType: "image/png"; data: string }[];
    },
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
  if (request.image) {
    const png = Buffer.from(request.image, "base64");
    if (
      session.settingsManager?.getBlockImages() !== false ||
      !session.model.input?.includes("image") ||
      png.length < 33 ||
      png.toString("base64") !== request.image ||
      !png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      png.toString("ascii", 12, 16) !== "IHDR" ||
      [png.readUInt32BE(16), png.readUInt32BE(20)].some(
        (n) => n < 1 || n > 1536,
      )
    )
      throw Error("Image unavailable for the active model or settings");
  }
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
    await session.prompt(request.text, {
      expandPromptTemplates: false,
      ...(request.image
        ? {
            images: [
              { type: "image", mimeType: "image/png", data: request.image },
            ],
          }
        : {}),
    });
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
