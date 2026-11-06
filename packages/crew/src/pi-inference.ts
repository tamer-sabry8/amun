export function selectedCredential(
  provider: string,
  output: string,
): { name: string; value: string } {
  try {
    if (output.length > 65536) throw new Error();
    const names: Record<string, string> = {
      openrouter: "OPENROUTER_API_KEY",
    };
    const data = JSON.parse(output) as Record<string, unknown>;
    if (
      !Object.hasOwn(names, provider) ||
      data.status !== "ready" ||
      data.provider !== provider ||
      typeof data.credentials !== "string" ||
      !data.credentials ||
      data.credentials.length > 16384 ||
      /[\r\n\0]/.test(data.credentials)
    )
      throw new Error();
    return { name: names[provider]!, value: data.credentials };
  } catch {
    throw new Error("Provider credential unavailable");
  }
}
/** Bounded evidence reducer; never treats an acknowledgement as completed inference. */
export class InferenceEvidence {
  text = "";
  complete = false;
  failed = false;
  deltas = 0;
  private stopped = false;
  accept(record: Record<string, unknown>): void {
    if (this.failed || this.complete) return;
    if (record.type === "tool_execution_start") {
      this.failed = true;
      return;
    }
    if (record.type === "message_update") {
      const event = record.assistantMessageEvent;
      if (
        event &&
        typeof event === "object" &&
        "type" in event &&
        event.type === "text_delta"
      ) {
        if (
          !("delta" in event) ||
          typeof event.delta !== "string" ||
          this.text.length + event.delta.length > 262144
        ) {
          this.failed = true;
          return;
        }
        this.text += event.delta;
        this.deltas++;
      }
    }
    if (record.type === "message_end") {
      const message = record.message;
      if (
        message &&
        typeof message === "object" &&
        "role" in message &&
        message.role === "assistant"
      ) {
        if (!("stopReason" in message) || message.stopReason !== "stop") {
          this.failed = true;
          return;
        }
        this.stopped = true;
      }
    }
    if (record.type === "agent_settled") {
      if (record.aborted !== false || !this.stopped || !this.text) {
        this.failed = true;
        return;
      }
      this.complete = true;
    }
  }
}

export function selectedCopilotCredential(
  input: unknown,
): Record<string, unknown> {
  const fail = () => {
    throw new Error("Selected Copilot OAuth unavailable");
  };
  if (!input || typeof input !== "object") return fail();
  const data = input as Record<string, unknown>;
  if (
    data.type !== "oauth" ||
    typeof data.access !== "string" ||
    !data.access ||
    data.access.length > 16384 ||
    typeof data.refresh !== "string" ||
    !data.refresh ||
    data.refresh.length > 16384 ||
    typeof data.expires !== "number" ||
    !Number.isFinite(data.expires) ||
    data.expires <= 0
  )
    return fail();
  const result: Record<string, unknown> = {
    type: "oauth",
    access: data.access,
    refresh: data.refresh,
    expires: data.expires,
  };
  if (data.enterpriseUrl !== undefined) {
    if (
      typeof data.enterpriseUrl !== "string" ||
      !data.enterpriseUrl ||
      data.enterpriseUrl.length > 253 ||
      !/^[-a-zA-Z0-9.]+$/.test(data.enterpriseUrl)
    )
      return fail();
    result.enterpriseUrl = data.enterpriseUrl;
  }
  if (data.availableModelIds !== undefined) {
    if (
      !Array.isArray(data.availableModelIds) ||
      data.availableModelIds.length > 2048 ||
      !data.availableModelIds.every(
        (id) => typeof id === "string" && id.length <= 256,
      )
    )
      return fail();
    result.availableModelIds = [...data.availableModelIds];
  }
  return result;
}
