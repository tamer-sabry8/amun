import { z } from "zod";
import { boundedMcpResponse } from "./notion-response.ts";
const clientId = "Ov23liy0rc9FOVsMe7Sd";
const challengeSchema = z.object({
  verification_uri: z.literal("https://github.com/login/device"),
  device_code: z.string().min(32).max(256),
  user_code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  interval: z.number().int().min(1).max(900),
  expires_in: z.number().int().positive().max(3600),
});
export const githubGrant = z.object({
  access_token: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[A-Za-z0-9_.-]+$/),
  scope: z.enum(["public_repo", "repo"]),
  token_type: z.literal("bearer"),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).max(4096).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});
type Grant = z.infer<typeof githubGrant>;
type Post = (
  path: "/login/device/code" | "/login/oauth/access_token",
  fields: Record<string, string>,
) => Promise<unknown>;
export const githubDevicePost: Post = async (path, fields) => {
  const response = await fetch("https://github.com" + path, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({ ...fields, client_id: clientId }),
    signal: AbortSignal.timeout(12000),
  });
  return boundedMcpResponse(response, 32768).json();
};
export class GithubDeviceLogin {
  private generation = 0;
  private busy = false;
  private pending:
    | undefined
    | {
        scope: "public_repo" | "repo";
        userCode: string;
        secret: string;
        expires: number;
        interval: number;
        next: number;
      };
  constructor(
    private post: Post,
    private open: () => Promise<void>,
    private save: (grant: Grant) => void,
    private now: () => number = Date.now,
  ) {}
  get userCode() {
    return this.pending?.userCode;
  }
  cancel() {
    this.generation++;
    this.pending = undefined;
  }
  async openBrowser() {
    if (!this.pending || this.now() >= this.pending.expires)
      throw Error("Code expired");
    await this.open();
  }
  async start(scope: "public_repo" | "repo" = "public_repo") {
    if (this.pending && this.pending.scope !== scope) this.cancel();
    if (this.pending && this.pending.expires > this.now())
      return this.pending.userCode;
    if (this.busy) throw Error("Sign-in already active");
    const generation = ++this.generation;
    this.busy = true;
    try {
      const d = challengeSchema.parse(
        await this.post("/login/device/code", { scope }),
      );
      if (generation !== this.generation) throw Error("Cancelled");
      const interval = d.interval * 1000;
      this.pending = {
        scope,
        userCode: d.user_code,
        secret: d.device_code,
        expires: this.now() + 1000 * d.expires_in,
        interval,
        next: this.now() + interval,
      };
      return d.user_code;
    } finally {
      this.busy = false;
    }
  }
  async check() {
    const d = this.pending;
    if (!d || this.now() >= d.expires) {
      this.cancel();
      throw Error("Sign-in expired");
    }
    if (this.busy || this.now() < d.next) return "pending";
    this.busy = true;
    d.next = this.now() + d.interval;
    try {
      const result = await this.post("/login/oauth/access_token", {
        device_code: d.secret,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      if (this.pending !== d || this.now() >= d.expires)
        throw Error("Sign-in ended");
      const error = z.object({ error: z.string() }).safeParse(result);
      if (
        error.success &&
        ["slow_down", "authorization_pending"].includes(error.data.error)
      ) {
        if (error.data.error === "slow_down") d.interval += 5000;
        d.next = this.now() + d.interval;
        return "pending";
      }
      this.pending = undefined;
      const grant = githubGrant.parse(result);
      if (grant.scope !== d.scope) throw Error("Unexpected GitHub scope");
      this.save(grant);
      return "authorized";
    } finally {
      this.busy = false;
    }
  }
}
