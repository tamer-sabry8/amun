/** Owner-operated M1 acceptance. This script is never called from packaged user onboarding. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  withCloudflareClient,
  cloudflareConsentArgs,
} from "../packages/auth/src/cloudflare-hosting.ts";
import { publishOrigin } from "../packages/hosting/src/deploy.ts";
const source = readFileSync(
  new URL("../packages/hosting/src/worker.js", import.meta.url),
  "utf8",
);
const digest = createHash("sha256").update(source).digest("hex");
if (process.argv[2] !== "--approved-sha256=" + digest)
  throw Error("Approve the exact Worker revision before deployment.");
const root = join(
  homedir(),
  "Library",
  "Application Support",
  "Amun",
  "hosting-acceptance",
);
let record: string | undefined,
  stage = "authorization";
try {
  await withCloudflareClient(
    {
      read: () => record,
      write: (v) => {
        record = v;
      },
      registerSecret: () => {},
      open: async (url) => {
        await promisify(execFile)("/usr/bin/open", cloudflareConsentArgs(url));
        console.log("Opened Cloudflare deployment consent in Edge.");
      },
    },
    "user:read account:read zone.read dns.read workers-scripts.read workers-scripts.write",
    async (client) => {
      stage = "API discovery";
      const tools = await client.callTool({
        name: "search",
        arguments: {
          code: 'async()=>Object.keys(spec.paths).filter(p=>p.includes("/workers/domains")||p.endsWith("/workers/scripts/{script_name}"))',
        },
      });
      if (
        tools.isError ||
        !JSON.stringify(tools.content).includes("/workers/domains")
      )
        throw Error();
      let step = 0;
      const worker = await publishOrigin(
        source,
        digest,
        async (code, accountId) => {
          stage =
            ["collision preflight", "Worker upload", "hostname binding"][
              step++
            ] ?? "unexpected step";
          const r = await client.callTool({
            name: "execute",
            arguments: {
              code,
              ...(accountId ? { account_id: accountId } : {}),
            },
          });
          const items = r.content;
          if (!Array.isArray(items) || items[0]?.type !== "text") throw Error();
          if (r.isError) {
            const msg = String(items[0].text);
            const hints = [
              "scope",
              "permission",
              "DNS conflict",
              "not found",
              "not authorized",
              "account_id",
              "404",
              "403",
              "10000",
              "Invalid",
            ];
            console.log(
              "Cloudflare error categories:",
              hints
                .filter((x) => msg.toLowerCase().includes(x.toLowerCase()))
                .join(", ") || "unclassified",
            );
            throw Error();
          }
          return JSON.parse(items[0].text);
        },
        () => {
          mkdirSync(root, { recursive: true, mode: 0o700 });
          writeFileSync(
            join(root, digest + ".attempt"),
            new Date().toISOString(),
            { flag: "wx", mode: 0o600 },
          );
        },
      );
      console.log(
        "Cloudflare confirmed the Worker and hostname:",
        worker,
        "amun.transfrm.ai",
      );
    },
  );
} catch {
  console.error(
    "Deployment incomplete during " +
      stage +
      ". Reconcile existing state before any further write.",
  );
  process.exitCode = 1;
} finally {
  record = undefined;
}
