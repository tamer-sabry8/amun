import path from "node:path";
import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import { resolveAmunPaths } from "./amun-paths.js";

/**
 * Paseo tools the First Mate may call (decision 19, "Read-only plus
 * heartbeats"). It can look at what Paseo runs and set timed prompts to
 * itself, but crew, worktrees, terminals and schedules that start agents go
 * only through Firstmate (fm-spawn, fm-send, fm-teardown), so Firstmate's
 * watcher and status files see every crewmate.
 */
export const FIRST_MATE_KEPT_TOOLS = [
  "speak",
  "list_hosts",
  "list_workspaces",
  "list_agents",
  "get_agent_status",
  "get_agent_activity",
  "list_terminals",
  "capture_terminal",
  "list_workspace_scripts",
  "list_schedules",
  "inspect_schedule",
  "schedule_logs",
  "list_providers",
  "list_models",
  "list_profiles",
  "inspect_provider",
  "list_pending_permissions",
  "create_heartbeat",
  "delete_heartbeat",
] as const;

/** Built-in Paseo tools hidden from the First Mate. */
export const FIRST_MATE_BLOCKED_TOOLS = [
  "create_agent",
  "send_agent_prompt",
  "cancel_agent",
  "archive_agent",
  "kill_agent",
  "update_agent",
  "set_agent_mode",
  "respond_to_permission",
  "create_workspace",
  "archive_workspace",
  "rename_workspace",
  "create_terminal",
  "kill_terminal",
  "send_terminal_keys",
  "start_workspace_script",
  "stop_workspace_script",
  "create_schedule",
  "pause_schedule",
  "resume_schedule",
  "update_schedule",
  "delete_schedule",
  "run_schedule_once",
] as const;

/** The provider's policy with the First Mate's blocked tools added. */
export function firstMateToolPolicy(
  base: ProviderPaseoToolsPolicy | undefined,
): ProviderPaseoToolsPolicy {
  const disabled = new Set([...(base?.disabledTools ?? []), ...FIRST_MATE_BLOCKED_TOOLS]);
  return { ...base, disabledTools: [...disabled] };
}

/**
 * The First Mate is the only agent Amun starts in the Firstmate checkout; crew
 * run in their own treehouse worktrees. Returns null when Amun is off or no
 * checkout is found, so every agent keeps the provider's policy.
 */
export function firstMateRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.AMUN_DISABLE === "1") return null;
  try {
    return resolveAmunPaths(env).firstmateRoot;
  } catch {
    return null;
  }
}

/** Narrows the policy for an agent running in the Firstmate checkout. */
export function paseoToolPolicyFor(
  root: string | null,
  cwd: string | undefined,
  base: ProviderPaseoToolsPolicy | undefined,
): ProviderPaseoToolsPolicy | undefined {
  if (!root || !cwd || path.resolve(cwd) !== path.resolve(root)) return base;
  return firstMateToolPolicy(base);
}
