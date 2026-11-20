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
import { recordFirstMateReply } from "../packages/work-store/src/first-mate-thread.ts";

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

// ── Sample chats: folders with several chats, and chats with no folder ──
const say = (
  workAreaId: string,
  chatId: string | null,
  role: "you" | "firstmate",
  text: string,
  unread = false,
) => {
  const id = must("message", { workAreaId, chatId, role, text });
  if (role === "firstmate" && !unread)
    must("read-messages", { messageIds: [id] });
  return id;
};
const gitex = must("create-area", {
  groupId: group,
  type: "project",
  name: "Gitex",
  client: "Events",
  dueAt: day(16),
});
say(
  gitex,
  null,
  "you",
  "Research the Gitex opportunity, then write the product vision and PRD.",
);
say(
  gitex,
  null,
  "firstmate",
  "On it. Researcher is gathering evidence first; the PRD follows once the report is in.",
);
for (const [title, ask, answer] of [
  [
    "Budget notes",
    "What budget do we have left for the Gitex stand?",
    "About AED 180,000 remains after the venue deposit.",
  ],
  [
    "Venue booking",
    "Has the venue confirmed hall 4?",
    "Not yet. The venue promised an answer by Thursday.",
  ],
  [
    "Demo script for the Amun booth and the investor walkthrough",
    "Draft a five-minute demo script for the booth.",
    "Here is a first draft with three beats.",
  ],
] as const) {
  const chat = must("new-chat", { workAreaId: gitex });
  say(gitex, chat, "you", ask);
  say(gitex, chat, "firstmate", answer, title === "Budget notes");
  must("rename-chat", { workAreaId: gitex, chatId: chat, title });
  if (title === "Venue booking")
    must("pin-chat", { workAreaId: gitex, chatId: chat, order: 1 });
}
for (let n = 1; n <= 20; n++) {
  const chat = must("new-chat", { workAreaId: gitex });
  say(
    gitex,
    chat,
    "you",
    `Gitex sample question ${n}: booth logistics item ${n}`,
  );
}
const amun = must("create-area", {
  groupId: group,
  type: "product",
  name: "Amun",
  client: "Internal",
});
say(amun, null, "you", "Summarise what shipped in Amun this week.");
say(
  amun,
  null,
  "firstmate",
  "Portfolio cards, the RFPs page and card panels shipped.",
);
const general = must("create-area", {
  groupId: group,
  type: "task",
  name: "Chat with Firstmate",
});
say(general, null, "you", "What changed since yesterday?");
say(general, null, "firstmate", "Two RFPs moved and one reminder is due.");
for (const [ask, answer] of [
  [
    "Draft a stakeholder update for Friday",
    "Here is a short update for Friday.",
  ],
  [
    "Which of my RFPs are at risk?",
    "Arabic citizen chatbot is due in five days.",
  ],
] as const) {
  const chat = must("new-chat", { workAreaId: general });
  say(general, chat, "you", ask);
  say(general, chat, "firstmate", answer);
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
  // A stand-in for Firstmate's request reports, for looking at the screens
  // only: a request is reported as being worked on, and its document arrives
  // later in a reply nobody asked for. A message that mentions a PRD takes
  // longer, so two requests in one chat finish out of order.
  "primary.send": (params) => {
    const text = String(params.text ?? "");
    const ref = /\[Amun request (amun-r-[0-9a-f]{12})\]/.exec(text)?.[1];
    if (!ref) return { reply: "Noted." };
    const ask = text.slice(text.indexOf(ref) + ref.length + 2).split("\n")[0]!;
    const prd = /\bprd\b/i.test(ask);
    const role = prd ? "Product Manager" : "Product Marketing";
    const block = (value: object) =>
      "```amun\n" + JSON.stringify(value) + "\n```";
    setTimeout(
      () => {
        recordFirstMateReply(
          work,
          `${prd ? "The PRD" : "The draft"} is ready.\n` +
            block({
              do: "document",
              title: prd ? "Gitex PRD" : "Launch email",
              type: prd ? "prd" : "doc",
              body: `# ${prd ? "Gitex PRD" : "Launch email"}\n\nA sample document.`,
              request: ref,
            }) +
            block({ do: "report", request: ref, status: "delivered", role, text: "done" }),
        );
        for (const client of sockets.clients)
          client.send(JSON.stringify({ event: "work.updated" }));
      },
      prd ? 12_000 : 5_000,
    );
    return {
      reply:
        `On it. ${role} has it.\n` +
        block({
          do: "report",
          request: ref,
          status: "working",
          role,
          text: prd ? "drafting the PRD" : "drafting the email",
        }),
    };
  },
  "primary.once": () => ({ asked: true }),
  "notion.request": () => [],
  "tools.request": () => [],
  "council.request": () => [],
  "work.search": (params) => ({
    hits: work.search(String(params.query ?? "")),
    steps: [],
  }),
  "happened.read": () => ({ available: false, turns: [] }),
  // No products in the preview; the screens under review do not use them.
  "workspace.snapshot": () => null,
  "workspace.command": () => null,
};

const wsPort = Number(process.env.PREVIEW_WS_PORT ?? 6790);
const httpPort = Number(process.env.PREVIEW_HTTP_PORT ?? 6791);
const sockets = new WebSocketServer({ port: wsPort, host: "127.0.0.1" });
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
}).listen(httpPort, "127.0.0.1", () =>
  console.log(
    `Preview: http://127.0.0.1:${httpPort}/index.html?daemon=ws://127.0.0.1:${wsPort}/amun`,
  ),
);
