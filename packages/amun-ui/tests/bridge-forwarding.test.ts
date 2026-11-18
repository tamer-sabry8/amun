import { it, expect, vi } from "vitest";

const uuid = "11111111-1111-4111-8111-111111111111";
// One sample for every result kind a renderer view listens for.
const samples: [string, unknown][] = [
  [
    "stakeholder-result",
    { version: 1, kind: "stakeholder-result", productId: null, request: uuid },
  ],
  [
    "delivery-result",
    {
      kind: "delivery-result",
      id: uuid,
      product: "p",
      story: "s",
      message: "",
    },
  ],
  [
    "prototype-result",
    {
      kind: "prototype-result",
      id: uuid,
      product: "p",
      objective: "o",
      message: "",
    },
  ],
  [
    "output-preview-result",
    { kind: "output-preview-result", id: uuid, message: "" },
  ],
  ["pr-result", { kind: "pr-result", id: uuid, product: "p", message: "" }],
  [
    "code-change-result",
    {
      kind: "code-change-result",
      id: uuid,
      product: "p",
      message: "",
      cards: [],
    },
  ],
  ["crew-roster", { kind: "crew-roster", members: null }],
  ["crew-inventory", { version: 1, kind: "crew-inventory", tasks: null }],
  [
    "crew-session-text",
    {
      version: 1,
      kind: "crew-session-text",
      taskId: "a1",
      live: true,
      text: "x",
    },
  ],
  [
    "crew-observation",
    {
      version: 1,
      kind: "crew-observation",
      taskId: "a1",
      endpoint: "unknown",
      worker: "unknown",
    },
  ],
  [
    "diagnostics-result",
    { version: 1, kind: "diagnostics-result", id: "d", text: "" },
  ],
  [
    "firstmate-chat-result",
    {
      kind: "firstmate-chat-result",
      productId: "p",
      id: uuid,
      phase: "done",
      text: "",
    },
  ],
  [
    "ado-operation-result",
    {
      kind: "ado-operation-result",
      requestId: uuid,
      productId: "p",
      message: "",
    },
  ],
  [
    "backlog-result error",
    {
      kind: "backlog-result",
      view: "error",
      requestId: uuid,
      productId: "p",
      message: "",
    },
  ],
  [
    "tracker-types-result",
    {
      version: 1,
      kind: "tracker-types-result",
      workAreaId: "w",
      project: null,
      story: null,
      task: null,
      needs: [],
    },
  ],
  [
    "content-search-result",
    { version: 1, kind: "content-search-result", requestId: "r", hits: [] },
  ],
  [
    "work-result",
    {
      version: 1,
      kind: "work-result",
      action: "a",
      ok: true,
      message: "",
      ref: null,
      step: null,
    },
  ],
];

it.each(samples)("forwards %s to listeners", async (_name, sample) => {
  let receive: (event: unknown) => void = () => {};
  const fakeWindow = {
    addEventListener: (_: string, fn: typeof receive) => {
      receive = fn;
    },
  };
  vi.stubGlobal("window", fakeWindow);
  vi.resetModules();
  const { bridge, initializeBridge } = await import("../src/bridge.ts");
  initializeBridge();
  const port = {
    onmessage: undefined as unknown as (event: unknown) => void,
    start() {},
    postMessage() {},
    close() {},
  };
  receive({ source: fakeWindow, data: { kind: "amun-port" }, ports: [port] });
  const seen: unknown[] = [];
  bridge.onEvent((event) => seen.push(event));
  port.onmessage({ data: sample });
  expect(seen).toHaveLength(1);
  expect((seen[0] as { kind: string }).kind).toBe(
    (sample as { kind: string }).kind,
  );
});
