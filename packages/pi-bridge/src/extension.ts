import { createHash } from "node:crypto";
import { bridgeCall } from "./client.ts";
import { bridgeTools, gateTool } from "./gate.ts";
type ToolEvent = {
  toolName: string;
  input: unknown;
  parentToolCallId?: string;
};
interface Pi {
  getCommands(): { name: string; sourceInfo: { path: string } }[];
  getAllTools(): { name: string; sourceInfo: { path: string } }[];
  on(
    name: "tool_call",
    fn: (
      event: ToolEvent,
    ) => Promise<{ block: true; reason: string } | undefined>,
  ): void;
  on(
    name: "session_start" | "agent_start" | "agent_settled",
    fn: () => Promise<void>,
  ): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: object;
    execute: (
      id: string,
      params: { summary?: string },
    ) => Promise<{
      content: { type: "text"; text: string }[];
      details: object;
    }>;
  }): void;
}
export default function amunBridge(pi: Pi) {
  const {
    AMUN_BRIDGE_SOCKET: path,
    AMUN_BRIDGE_TOKEN: token,
    AMUN_BRIDGE_ENTRY: entry,
  } = process.env;
  const request = (body: unknown) => {
    if (!path || !token || !entry) throw Error("Missing Amun bridge");
    return bridgeCall(path, token, body);
  };
  let conflict = true;
  pi.on("session_start", async () => {
    conflict = true;
    const replacement = pi
      .getCommands()
      .some(
        (command) =>
          command.name === "mcp" && command.sourceInfo.path !== "builtin:mcp",
      );
    if (replacement) {
      await request({ op: "event", name: "mcp_replaced" });
      return;
    }
    await request({ op: "event", name: "bridge_ready" });
    conflict = false;
  });
  for (const name of ["agent_start", "agent_settled"] as const)
    pi.on(name, async () => {
      await request({ op: "event", name }).catch(() => undefined);
    });
  pi.on("tool_call", async (event) => {
    try {
      if (conflict)
        return {
          block: true,
          reason: "Amun detected a conflicting MCP command.",
        };
      if (entry && Object.hasOwn(bridgeTools, event.toolName)) {
        const matches = pi
          .getAllTools()
          .filter((t) => t.name === event.toolName);
        if (matches.length === 1 && matches[0]?.sourceInfo.path === entry)
          return;
      }
      return await gateTool(event, async (name, nested) => {
        const data = JSON.stringify(event.input);
        if (typeof data !== "string" || Buffer.byteLength(data) > 262144)
          throw Error();
        return request({
          op: "gate",
          name,
          nested,
          digest: createHash("sha256").update(data).digest("hex"),
        });
      });
    } catch {
      return { block: true, reason: "Amun bridge unavailable." };
    }
  });
  for (const [name, description] of Object.entries(bridgeTools)) {
    pi.registerTool({
      name,
      label: description,
      description,
      parameters: {
        type: "object",
        additionalProperties: false,
        ...(name === "amun_get_context"
          ? { properties: {} }
          : {
              required: ["summary"],
              properties: {
                summary: { type: "string", minLength: 1, maxLength: 1024 },
              },
            }),
      },
      async execute(_id, params) {
        const text = await request({
          op: "tool",
          name,
          summary: params.summary ?? "",
        });
        return { content: [{ type: "text", text }], details: {} };
      },
    });
  }
}
