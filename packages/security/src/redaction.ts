import pino, { type DestinationStream } from "pino";
const sensitive =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|id_token|api[_-]?key|credential(?:s)?|code_verifier|env|environment|.*(?:secret|password|token|credentials?|api[_-]?key))$/i;
export class Redactor {
  private readonly secrets = new Set<string>();
  register(secret: string): void {
    if (!secret || secret.length > 65536)
      throw new Error("Invalid secret registration");
    for (const value of [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"),
      Buffer.from(":" + secret).toString("base64"),
    ])
      this.secrets.add(value);
  }
  text(value: string): string {
    let result = value.slice(0, 1_000_000);
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
      result = result.split(secret).join("[REDACTED]");
    return result
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        "[REDACTED PRIVATE KEY]",
      )
      .replace(
        /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|(?:secret_|ntn_)[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,
        "[REDACTED]",
      )
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[REDACTED]",
      )
      .replace(
        /\b(?:set-cookie|cookie|authorization|proxy-authorization)\s*:\s*[^\r\n]+/gi,
        "[REDACTED HEADER]",
      )
      .replace(
        /(\b[A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
        "$1[REDACTED]",
      )
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
      .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
      .replace(
        /([?&](?:access_token|refresh_token|token|api_key|password|code)=)[^&\s"']*/gi,
        "$1[REDACTED]",
      );
  }
  clean(input: unknown): unknown {
    const seen = new Set<object>();
    let nodes = 0;
    const walk = (value: unknown, depth: number): unknown => {
      if (depth > 20 || ++nodes > 10000) return "[TRUNCATED]";
      if (typeof value === "string") return this.text(value);
      if (value === null || typeof value === "boolean") return value;
      if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
      if (typeof value !== "object" || !value) return "[UNSUPPORTED]";
      if (seen.has(value)) return "[CIRCULAR]";
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null &&
        !Array.isArray(value)
      )
        return "[UNSUPPORTED]";
      seen.add(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Array.isArray(value))
        return Array.from(
          { length: Math.min(value.length, 1000) },
          (_, index) => {
            const d = descriptors[String(index)];
            return d && "value" in d
              ? walk(d.value, depth + 1)
              : "[UNSUPPORTED]";
          },
        );
      const result: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      for (const key of Object.keys(descriptors).slice(0, 1000)) {
        const d = descriptors[key]!;
        if (!d.enumerable) continue;
        result[this.text(key)] = sensitive.test(key)
          ? "[REDACTED]"
          : "value" in d
            ? walk(d.value, depth + 1)
            : "[UNSUPPORTED]";
      }
      return result;
    };
    return walk(input, 0);
  }
}
export function createSafeLogger(
  redactor: Redactor,
  destination: DestinationStream,
) {
  const logger = pino(
    {
      base: null,
      redact: {
        paths: ["password", "token", "authorization", "credentials"],
        censor: "[REDACTED]",
      },
    },
    destination,
  );
  return {
    info: (event: string, details: unknown = {}) =>
      logger.info({ details: redactor.clean(details) }, redactor.text(event)),
    error: (event: string, details: unknown = {}) =>
      logger.error({ details: redactor.clean(details) }, redactor.text(event)),
  };
}
