// A stand-in for the Amun daemon, for looking at screens in a browser with
// sample work and no Firstmate. Design previews and screenshots only.
//
//   npm run build -w @amun/ui
//   npx tsx scripts/preview-daemon.ts
//   open http://127.0.0.1:6791/index.html?daemon=ws://127.0.0.1:6790/amun
//
// Nothing here ships: it is not part of any build.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { openWorkStore } from "../packages/work-store/src/index.ts";

const build = fileURLToPath(
  new URL("../packages/amun-ui/build/", import.meta.url),
);
const work = openWorkStore(":memory:").store;
const send = (action: string, payload: object = {}) =>
  (
    work.handle({ version: 1, kind: "work", action, ...payload } as never) as {
      kind: string;
      ref?: string | null;
      ok?: boolean;
      message?: string;
    }[]
  ).find((event) => event.kind === "work-result")!;
const must = (action: string, payload: object = {}) => {
  const result = send(action, payload);
  if (!result.ok) throw new Error(`${action}: ${result.message}`);
  return result.ref!;
};

// ── Sample work ──
const group = must("add-group", { name: "Work" });
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString();
for (const [type, name, client, due] of [
  ["product", "MARC", "CEO", 14],
  ["project", "TICAO - AI", "TICAO", null],
  ["product", "Smart Parks - AI (IoT)", "DMT", null],
  ["project", "Vcity", "Dr. Ibraheem", -220],
  ["project", "ICP Services (Phase 2)", "ICP", 33],
  ["project", "MoI 15 Services", "MoI", 41],
] as const)
  must("create-area", {
    groupId: group,
    type,
    name,
    client,
    ...(due === null ? {} : { dueAt: day(due) }),
  });
const rfps: {
  name: string;
  client: string;
  due: number;
  stage: string;
  value?: number;
  next?: [string, number];
  team?: string[];
  owner: string;
  hold?: string;
  loss?: string;
  summary?: string;
}[] = [
  {
    name: "Smart parking analytics",
    client: "Example client A",
    due: 24,
    stage: "received",
    value: 900_000,
    next: ["Review the RFP documents", 2],
    owner: "Solution Architect",
    summary:
      "Reviewing the RFP documents; clarification questions go out this week.",
  },
  {
    name: "Arabic citizen chatbot",
    client: "Example client B",
    due: 5,
    stage: "in_response",
    value: 1_400_000,
    next: ["Finish the technical proposal", 3],
    owner: "Project Manager",
    team: ["Data Scientist", "Solution Architect"],
    summary: "Client confirmed on-premises deployment only, no cloud.",
  },
  {
    name: "Document AI for permits",
    client: "Example client C",
    due: 35,
    stage: "in_response",
    next: ["Follow up with the client IT team", 4],
    owner: "Data Scientist",
    hold: "Waiting for the client to share data samples",
    summary:
      "Waiting for the client to share data samples. Followed up by email.",
  },
  {
    name: "Video analytics for public safety",
    client: "Example client D",
    due: -18,
    stage: "won",
    value: 2_100_000,
    owner: "Solution Architect",
    team: ["Project Manager"],
    summary: "Strongest technical score and a working demo.",
  },
  {
    name: "HR assistant",
    client: "Example client E",
    due: -32,
    stage: "lost",
    value: 600_000,
    owner: "Project Manager",
    loss: "Price was about 20% above the winning bid.",
  },
];
for (const rfp of rfps) {
  const id = must("save-rfp", {
    groupId: group,
    name: rfp.name,
    client: rfp.client,
    deadline: day(rfp.due),
    responseOwner: rfp.owner,
  });
  must("move-rfp", {
    areaId: id,
    stage: rfp.stage,
    lossReason: rfp.loss ?? null,
  });
  must("update-rfp", {
    areaId: id,
    patch: {
      ...(rfp.value ? { value: rfp.value } : {}),
      ...(rfp.next
        ? { nextStep: rfp.next[0], nextStepAt: day(rfp.next[1]) }
        : {}),
      ...(rfp.team ? { team: rfp.team } : {}),
      source: "Existing client",
    },
  });
  if (rfp.hold) must("hold-rfp", { areaId: id, held: true, reason: rfp.hold });
  if (rfp.summary) must("add-rfp-summary", { areaId: id, text: rfp.summary });
}

// ── The daemon's answers ──
const answers: Record<string, (params: Record<string, unknown>) => unknown> = {
  "spaces.list": () => [{ slug: "home", name: "Firstmate home" }],
  "work.snapshot": () => work.snapshot(),
  "work.command": (params) =>
    work.handle({
      ...(params.command as object),
      version: 1,
      kind: "work",
    } as never),
  "fleet.snapshot": () => ({ tasks: [] }),
  "holds.list": () => [],
  "connections.list": () => [],
  "models.list": () => ({
    current: "preview",
    models: [{ id: "preview", label: "Preview (no model)" }],
  }),
  "accounts.check": (params) => ({
    provider: params.provider,
    status: "missing",
    reason: null,
  }),
  "primary.start": () => ({ agentId: "preview" }),
  "primary.send": () => ({ reply: "Noted." }),
  "primary.once": () => ({ asked: true }),
  "notion.request": () => [],
  "tools.request": () => [],
  "council.request": () => [],
  "work.search": () => ({ hits: [], steps: [] }),
  "happened.read": () => ({ available: false, turns: [] }),
  // No products in the preview; the screens under review do not use them.
  "workspace.snapshot": () => null,
  "workspace.command": () => null,
};

const sockets = new WebSocketServer({ port: 6790, host: "127.0.0.1" });
sockets.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const { id, method, ...params } = JSON.parse(String(raw)) as {
      id: string;
      method: string;
    } & Record<string, unknown>;
    const answer = answers[method];
    try {
      if (!answer) {
        console.error("no answer for", method);
        socket.send(
          JSON.stringify({
            id,
            ok: false,
            error: { code: "preview", message: "Not in the preview." },
          }),
        );
        return;
      }
      socket.send(JSON.stringify({ id, ok: true, result: answer(params) }));
    } catch (error) {
      socket.send(
        JSON.stringify({
          id,
          ok: false,
          error: { code: "preview", message: String(error) },
        }),
      );
    }
  });
});

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
createServer((request, response) => {
  const path = normalize(
    decodeURIComponent((request.url ?? "/").split("?")[0]!),
  ).replace(/^(\.\.[/\\])+/, "");
  const file = join(build, path === "/" ? "index.html" : path);
  if (
    !file.startsWith(build) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(6791, "127.0.0.1", () =>
  console.log(
    "Preview: http://127.0.0.1:6791/index.html?daemon=ws://127.0.0.1:6790/amun",
  ),
);
