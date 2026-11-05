import { describe, expect, it } from "vitest";
import { windowPreferences, contentSecurityPolicy } from "../src/security.js";

describe("desktop isolation policy", () => {
  it("sandboxes unprivileged content without Node or preload capabilities", () => {
    expect(windowPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    expect(windowPreferences).not.toHaveProperty("preload");
  });
  it("forbids network, objects, inline execution and framing in the app shell", () => {
    for (const directive of [
      "default-src 'none'",
      "script-src 'self'",
      "connect-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
    ]) {
      expect(contentSecurityPolicy.split(";").map((x) => x.trim())).toContain(
        directive,
      );
    }
    expect(contentSecurityPolicy).not.toContain("unsafe-inline");
    expect(contentSecurityPolicy).not.toContain("unsafe-eval");
  });
});
