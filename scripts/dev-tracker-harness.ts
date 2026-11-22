// Dev-only acceptance harness (not shipped): drives TrackerHost against the
// real hosted MCP servers with a separate Keychain service. Usage:
//   node --experimental-strip-types scripts/dev-tracker-harness.ts <root> connect|check|disconnect <linear|jira>
//   ... <root> call <linear|jira> <tool> '<json args>'
import { AsyncEntry } from "@napi-rs/keyring";
import { TrackerHost, toolJson, type TrackerId } from "../packages/notion/src/tracker-host.ts";
const [root, verb, provider, tool, json] = process.argv.slice(2) as [
  string,
  string,
  TrackerId,
  string?,
  string?,
];
const service = "ai.amun.dev-acceptance";
const host = new TrackerHost({
  workspace: "dev-acceptance",
  root,
  registerSecret: () => {},
  secrets: {
    get: async (a) =>
      (await new AsyncEntry(service, a).getPassword()) ?? undefined,
    set: async (a, s) => void (await new AsyncEntry(service, a).setPassword(s)),
    delete: async (a) =>
      void (await new AsyncEntry(service, a).deleteCredential()),
  },
});
if (verb === "connect" || verb === "check")
  console.log(JSON.stringify(await host.connect(provider, verb === "connect")));
else if (verb === "disconnect")
  console.log(JSON.stringify(await host.disconnect(provider)));
else if (verb === "call")
  console.log(
    JSON.stringify(
      await host.use(provider, async (s) => {
        const r = await s.call(tool!, JSON.parse(json ?? "{}"));
        return { isError: r.isError, data: toolJson(r) };
      }),
      null,
      1,
    ),
  );
