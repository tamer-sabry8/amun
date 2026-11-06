import { it, expect } from "vitest";
import { Redactor, createSafeLogger } from "../src/redaction.ts";
it("removes registered secret variants and credential fields from every nested output", () => {
  const redactor = new Redactor();
  const secret = "CANARY-private-73f/+=";
  redactor.register(secret);
  const input = {
    text: "contains " + secret,
    nested: [
      {
        Authorization: "Bearer another",
        password: "another",
        safe: encodeURIComponent(secret),
      },
    ],
    encoded: Buffer.from(secret).toString("base64"),
    url: "https://user:pass@example.test/?access_token=another",
    cookie: "private",
  };
  const output = JSON.stringify(redactor.clean(input));
  expect(output).not.toContain(secret);
  expect(output).not.toContain(encodeURIComponent(secret));
  expect(output).not.toContain(Buffer.from(secret).toString("base64"));
  expect(output).not.toContain("another");
  expect(output).not.toContain("user:pass");
  expect(output).toContain("[REDACTED]");
});
it("never executes getters or serializes exception messages, process environments or cycles", () => {
  const redactor = new Redactor();
  let calls = 0;
  const input = Object.defineProperty({ error: new Error("CANARY") }, "bad", {
    enumerable: true,
    get() {
      calls++;
      return "CANARY";
    },
  });
  const output = JSON.stringify(redactor.clean(input));
  expect(calls).toBe(0);
  expect(output).not.toContain("CANARY");
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => redactor.clean(cycle)).not.toThrow();
  expect(redactor.clean({ env: { PATH: "private" } })).toEqual({
    env: "[REDACTED]",
  });
});
it("pino output applies redaction to both event text and fields", () => {
  const redactor = new Redactor();
  const secret = "CANARY-auth-23987";
  redactor.register(secret);
  let output = "";
  const logger = createSafeLogger(redactor, {
    write(chunk: string) {
      output += chunk;
    },
  });
  logger.info("event " + secret, {
    detail: secret,
    token: "unregistered",
    err: new Error(secret),
  });
  expect(output).not.toContain(secret);
  expect(output).not.toContain("unregistered");
  expect(JSON.parse(output).level).toBe(30);
});
it("bounds traversal and handles short invalid secret registration safely", () => {
  const redactor = new Redactor();
  expect(() => redactor.register("")).toThrow();
  expect(() => redactor.register("a".repeat(65537))).toThrow();
  let value: unknown = "end";
  for (let i = 0; i < 50; i++) value = { nested: value };
  expect(JSON.stringify(redactor.clean(value))).toContain("[TRUNCATED]");
});

it("redacts common credential key variants and Basic-encoded PATs", () => {
  const redactor = new Redactor();
  const secret = "CANARY-basic-token";
  redactor.register(secret);
  const output = JSON.stringify(
    redactor.clean({
      client_secret: "unregistered-sensitive",
      refreshToken: "unregistered-sensitive",
      header: Buffer.from(":" + secret).toString("base64"),
    }),
  );
  expect(output).not.toContain("unregistered-sensitive");
  expect(output).not.toContain(Buffer.from(":" + secret).toString("base64"));
});
