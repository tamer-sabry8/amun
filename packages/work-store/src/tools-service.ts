// "Tools already on this Mac": looks for the agent command-line tools Amun
// knows, and remembers which ones the owner turned off, made the default or
// added by hand. Looking never runs more than each tool's version command.
import { toolsCommand } from "../../contracts/src/work.ts";
import type { ProbeResult } from "../../domain/src/tool-detection.ts";
import type { Database } from "./sqlite.ts";
import { probeTools } from "./tool-probe.ts";
import { ToolRegistry } from "./tool-registry.ts";

type Probe = (
  tools: ReturnType<ToolRegistry["tools"]>,
) => Promise<Record<string, ProbeResult>>;

/** A stable short name from the label the person typed. */
function manualId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^[^a-z]+|_+$/g, "")
      .slice(0, 32) || "tool"
  );
}

export class ToolsService {
  private readonly registry: ToolRegistry;

  constructor(
    db: Database,
    private readonly probe: Probe = (tools) => probeTools(tools),
  ) {
    this.registry = new ToolRegistry(db);
  }

  /** Applies one renderer "tools" command and answers with a fresh report. */
  async handle(message: unknown) {
    const command = toolsCommand.parse(message);
    let problem = "";
    try {
      if (command.action === "enable")
        this.registry.setEnabled(command.id, command.enabled);
      else if (command.action === "default")
        this.registry.setDefault(command.id);
      else if (command.action === "remove") this.registry.remove(command.id);
      else if (command.action === "add")
        this.registry.addManual(
          manualId(command.label),
          command.label,
          command.path,
        );
    } catch (error) {
      problem = error instanceof Error ? error.message : "";
    }
    return {
      version: 1 as const,
      kind: "tools-report" as const,
      message: problem,
      tools: this.registry.report(await this.probe(this.registry.tools())),
    };
  }
}
