import { it, expect } from "vitest";
import {
  addedPermissions,
  compareVersions,
  compatible,
  describePermissions,
  manifestProblems,
  nextStages,
  type PluginManifest,
} from "../src/plugins.ts";

const provider: PluginManifest = {
  id: "private-llm",
  name: "Private LLM",
  kind: "model_provider",
  origin: "customer",
  version: "1.4.2",
  description: "Company-hosted model endpoint",
  permissions: { network: ["llm.corp.example"], credentials: ["llm-key"] },
  provider: { name: "corp", baseUrl: "https://llm.corp.example/v1" },
};

it("accepts a valid manifest and lists every problem of an invalid one", () => {
  expect(manifestProblems(provider)).toEqual([]);
  expect(manifestProblems([])).toEqual(["A manifest must be an object"]);
  expect(
    manifestProblems({
      ...provider,
      name: " ",
      origin: "nobody",
      description: "",
      minAppVersion: "new",
      permissions: { reads: [""] },
      provider: { name: "", baseUrl: "ftp://x" },
    }),
  ).toEqual([
    "name is required",
    "origin must be first_party, customer or third_party",
    "description is required",
    "minAppVersion must look like 1.2.3",
    "permissions.reads must be a list of names",
    "provider.name is required",
    "provider.baseUrl must be an https URL",
  ]);
  expect(
    manifestProblems({
      ...provider,
      kind: "connector",
      connector: { transport: "pipe", target: "x" },
    }),
  ).toContain("connector.transport must be stdio or http");
  expect(
    manifestProblems({
      ...provider,
      kind: "connector",
      connector: { transport: "stdio", target: "acme-mcp" },
    }),
  ).toEqual([]);
  expect(manifestProblems({ ...provider, kind: "teleporter" })).toContain(
    "kind is not a supported extension point",
  );
  expect(
    manifestProblems({
      ...provider,
      kind: "interface",
      interface: { widgets: [] },
    }),
  ).toContain("interface needs a widget");
  expect(
    manifestProblems({
      ...provider,
      kind: "interface",
      interface: { widgets: [{ kind: "private-llm.x", slot: "ceiling" }] },
    }),
  ).toEqual(["unknown widget slot ceiling"]);
  expect(
    manifestProblems({
      ...provider,
      kind: "workflow",
      workflow: { stages: [] },
    }),
  ).toContain("workflow needs at least one stage");
  expect(
    manifestProblems({
      ...provider,
      kind: "workflow",
      workflow: {
        stages: [
          { id: "a", title: "A", validation: "Checked" },
          { id: "a", title: "" },
        ],
      },
    }),
  ).toEqual([
    "workflow stage ids must be unique",
    "every workflow stage needs an id and a title",
  ]);
});

it("compares versions and compatibility windows", () => {
  expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
  expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  expect(() => compareVersions("1", "2.0.0")).toThrow();
  expect(compatible(provider, "0.1.0")).toBe(true);
  expect(compatible({ ...provider, minAppVersion: "0.2.0" }, "0.1.0")).toBe(
    false,
  );
  expect(compatible({ ...provider, maxAppVersion: "1.0.0" }, "0.9.9")).toBe(
    true,
  );
  expect(compatible({ ...provider, maxAppVersion: "1.0.0" }, "1.0.0")).toBe(
    false,
  );
});

it("describes access in plain lines and reports only what an update adds", () => {
  expect(describePermissions(provider)).toEqual([
    "Contacts: llm.corp.example",
    "Needs credentials: llm-key",
  ]);
  expect(
    addedPermissions(provider, {
      ...provider,
      permissions: {
        network: ["llm.corp.example", "b.example"],
        writes: ["prds"],
      },
    }),
  ).toEqual(["network: b.example", "writes: prds"]);
});

it("follows a workflow in order, through branches and human checkpoints", () => {
  const stages = [
    { id: "draft", title: "Draft", humanCheckpoint: true },
    { id: "review", title: "Review", next: ["draft", "publish"] },
    { id: "publish", title: "Publish", validation: "Page exists" },
  ];
  expect(nextStages(stages, "draft")).toEqual({
    stages: ["review"],
    needsApproval: true,
  });
  expect(nextStages(stages, "review")).toEqual({
    stages: ["draft", "publish"],
    needsApproval: false,
  });
  expect(nextStages(stages, "publish")).toEqual({
    stages: [],
    needsApproval: false,
  });
  expect(() => nextStages(stages, "nope")).toThrow();
});
