import { it, expect } from "vitest";
import {
  parseManifest,
  portBadge,
  taskEnvironment,
  teardownPlan,
} from "../src/lifecycle.ts";

it("parses commands as one string or a list and injects the task's port", () => {
  const manifest = parseManifest(
    JSON.stringify({
      setup: "pnpm install",
      run: ["pnpm dev --port $WORKSPACE_PORT"],
      teardown: ["docker compose down"],
      env: { NODE_ENV: "development" },
    }),
  );
  expect(manifest).toEqual({
    setup: ["pnpm install"],
    run: ["pnpm dev --port $WORKSPACE_PORT"],
    teardown: ["docker compose down"],
    env: { NODE_ENV: "development" },
  });
  expect(taskEnvironment(manifest, 4102)).toEqual({
    NODE_ENV: "development",
    WORKSPACE_PORT: "4102",
    PORT: "4102",
  });
  expect(parseManifest("{}")).toEqual({
    setup: [],
    run: [],
    teardown: [],
    env: {},
  });
  expect(teardownPlan(manifest, 4102)).toEqual([
    "Run: docker compose down",
    "Stop background processes started by this task",
    "Release port 4102",
  ]);
  expect(teardownPlan(parseManifest("{}"), null)).toEqual([
    "Stop background processes started by this task",
  ]);
});

it("refuses malformed manifests, unknown keys, a preset port and secrets", () => {
  expect(() => parseManifest("not json")).toThrow(/not valid JSON/);
  expect(() => parseManifest("[]")).toThrow(/must be an object/);
  expect(() => parseManifest("x".repeat(70000))).toThrow(/too large/);
  expect(() =>
    parseManifest(
      JSON.stringify({
        deploy: "x",
        setup: [""],
        env: { WORKSPACE_PORT: "1", API_KEY: "k", lower: "x" },
      }),
    ),
  ).toThrow(
    "Unknown lifecycle key: deploy; WORKSPACE_PORT is assigned by Amun and cannot be set; env.API_KEY looks like a secret; keep secrets out of the manifest; env.lower must be an upper-case name with a text value; setup must be a command or a short list of commands",
  );
  expect(() => parseManifest(JSON.stringify({ env: [] }))).toThrow(
    /env must be an object/,
  );
});

it("shows a clickable badge only while the service can be opened", () => {
  expect(portBadge(4102, "healthy")).toEqual({
    label: ":4102",
    url: "http://127.0.0.1:4102/",
    status: "Running",
  });
  expect(portBadge(4102, "unreachable")).toMatchObject({
    status: "Not responding",
    url: "http://127.0.0.1:4102/",
  });
  expect(portBadge(4102, "stopped")).toMatchObject({
    url: null,
    status: "Stopped",
  });
  expect(portBadge(null, "starting")).toEqual({
    label: "No port",
    url: null,
    status: "No port assigned",
  });
});
