// Shell v3 (handoff §4, Q57–Q68): navigation, layout, Island, composer, wizard.

export const tiles = [
  ["agents", "Agents"],
  ["council", "Council"],
  ["roadmap", "Roadmap"],
  ["sprints", "Sprints"],
  ["portfolio", "Portfolio"],
  ["rfps", "RFPs"],
] as const;
export type Tile = (typeof tiles)[number][0];
export const railItems = [
  ["activity", "Activity"],
  ["downloads", "Downloads"],
  ["library", "Library"],
  ["decisions", "Decisions"],
] as const;
export type RailItem = (typeof railItems)[number][0];
export type Route = "home" | Tile | "settings" | "work" | "setup";

/** Words that must not appear outside Settings › Advanced (handoff §1). */
export const runtimeVocabulary = [
  "harness",
  "charter",
  "worktree",
  "revision",
  "routing table",
  "tmux",
  "herdr",
] as const;
export function leaksRuntimeVocabulary(copy: string) {
  const lower = copy.toLowerCase();
  return (
    runtimeVocabulary.find((word) => lower.includes(word)) ??
    (/\bpi\b/i.test(copy) ? "Pi" : null)
  );
}

export interface ShellLayout {
  route: Route;
  workAreaId: string | null;
  /** User's own choice, restored when the artifact closes. */
  sidebar: "open" | "collapsed";
  /** Collapsed by a work session rather than by the user. */
  autoCollapsed: boolean;
  artifact: {
    open: boolean;
    ratio: number;
    expanded: boolean;
    restore: number;
  };
  rail: RailItem | null;
  railExpanded: boolean;
  palette: boolean;
}
export const minRatio = 0.28;
export const maxRatio = 0.72;
export const initialShell: ShellLayout = {
  route: "home",
  workAreaId: null,
  sidebar: "open",
  autoCollapsed: false,
  artifact: { open: false, ratio: 0.5, expanded: false, restore: 0.5 },
  rail: null,
  railExpanded: false,
  palette: false,
};
export type ShellAction =
  | { type: "go"; route: Exclude<Route, "work"> }
  | { type: "open_work"; workAreaId: string }
  | { type: "artifact"; open: boolean }
  | { type: "resize"; ratio: number }
  | { type: "expand_artifact" }
  | { type: "toggle_sidebar" }
  | { type: "rail"; item: RailItem | null }
  | { type: "expand_rail" }
  | { type: "palette"; open: boolean };

const clamp = (ratio: number) => Math.min(maxRatio, Math.max(minRatio, ratio));
export function shellReducer(
  state: ShellLayout,
  action: ShellAction,
): ShellLayout {
  switch (action.type) {
    case "go":
      return {
        ...state,
        route: action.route,
        workAreaId: null,
        autoCollapsed: false,
        artifact: { ...state.artifact, open: false, expanded: false },
        railExpanded: false,
        palette: false,
      };
    case "open_work":
      // Opening a work area enters its conversation directly: no recap screen.
      return {
        ...state,
        route: "work",
        workAreaId: action.workAreaId,
        palette: false,
        railExpanded: false,
      };
    case "artifact":
      // The sidebar collapses to icons while an artifact is open and comes back
      // to the user's own setting when it closes (Q29).
      return {
        ...state,
        autoCollapsed: action.open,
        artifact: { ...state.artifact, open: action.open, expanded: false },
      };
    case "resize":
      return {
        ...state,
        artifact: {
          ...state.artifact,
          ratio: clamp(action.ratio),
          restore: clamp(action.ratio),
          expanded: false,
        },
      };
    case "expand_artifact":
      return {
        ...state,
        artifact: state.artifact.expanded
          ? {
              ...state.artifact,
              expanded: false,
              ratio: state.artifact.restore,
            }
          : {
              ...state.artifact,
              expanded: true,
              restore: state.artifact.ratio,
              ratio: 1,
            },
      };
    case "toggle_sidebar":
      return state.autoCollapsed
        ? { ...state, autoCollapsed: false, sidebar: "open" }
        : {
            ...state,
            sidebar: state.sidebar === "open" ? "collapsed" : "open",
          };
    case "rail":
      return {
        ...state,
        rail: state.rail === action.item ? null : action.item,
        railExpanded: false,
      };
    case "expand_rail":
      return state.rail
        ? { ...state, railExpanded: !state.railExpanded }
        : state;
    case "palette":
      return { ...state, palette: action.open };
  }
}
export const sidebarCollapsed = (state: ShellLayout) =>
  state.autoCollapsed || state.sidebar === "collapsed";

// ── Island (Q31–Q32) ─────────────────────────────────────────────────────────
export const islandFloatMs = 6000;
/**
 * In the collapsed sidebar a new item floats out for about six seconds and
 * returns to icon + badge. It never takes focus, and with reduced motion it
 * does not float at all. Dismissing is not approving.
 */
export function islandPresentation(input: {
  collapsed: boolean;
  newItemAt: number | null;
  now: number;
  reducedMotion: boolean;
  hovered: boolean;
}) {
  if (!input.collapsed) return { mode: "card" as const, stealFocus: false };
  const floating =
    input.hovered ||
    (!input.reducedMotion &&
      input.newItemAt !== null &&
      input.now - input.newItemAt < islandFloatMs);
  return {
    mode: floating ? ("floating" as const) : ("badge" as const),
    stealFocus: false,
  };
}
export const islandWriteOwn = "Write my own response";

// ── Composer (Q27, Q70) ──────────────────────────────────────────────────────
export const plusMenu = [
  ["files", "Upload files"],
  ["screenshot", "Screenshot"],
  ["github", "Add from GitHub"],
  ["ado", "Add from Azure DevOps"],
  ["notion", "Add from Notion"],
  ["connector", "Add connector"],
] as const;
export interface SlashCommand {
  name: string;
  hint: string;
  description: string;
}
export const builtInCommands: SlashCommand[] = [
  { name: "prd", hint: "", description: "Draft a short PRD" },
  { name: "stories", hint: "", description: "Propose stories from the PRD" },
  { name: "research", hint: "<question>", description: "Research a question" },
  { name: "sprint plan", hint: "", description: "Propose the next sprint" },
  { name: "prioritize", hint: "", description: "Propose Now / Next / Later" },
  { name: "update", hint: "", description: "Draft a stakeholder update" },
  { name: "model", hint: "", description: "See or change the model in use" },
  { name: "theme", hint: "", description: "Change the theme" },
];
export type ComposerTrigger =
  { trigger: "/"; query: string } | { trigger: "@"; query: string } | null;
/** Which menu the text at the caret opens. `/` only at the start; `@` anywhere. */
export function composerTrigger(
  text: string,
  caret = text.length,
): ComposerTrigger {
  const before = text.slice(0, caret);
  if (/^\/[^\n]*$/.test(before) && !/\s--?\S*\s/.test(before))
    return { trigger: "/", query: before.slice(1).toLowerCase() };
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before);
  return mention ? { trigger: "@", query: mention[1]!.toLowerCase() } : null;
}
export function matchCommands(commands: SlashCommand[], query: string) {
  const q = query.trim();
  return commands.filter(
    (command) => command.name.startsWith(q) || q.startsWith(command.name + " "),
  );
}
export function matchMentions(
  query: string,
  agents: { id: string; name: string }[],
  workAreas: { id: string; name: string }[],
) {
  const hit = (name: string) => name.toLowerCase().includes(query);
  return [
    ...agents
      .filter((agent) => hit(agent.name))
      .map((agent) => ({ kind: "agent" as const, ...agent })),
    ...workAreas
      .filter((area) => hit(area.name))
      .map((area) => ({ kind: "work" as const, ...area })),
  ].slice(0, 8);
}
/** "Auto · Sonnet 5.5": routing is automatic and every run shows the model it used. */
export function routingLabel(model: string | null, manual = false) {
  return model ? `${manual ? "Chosen" : "Auto"} · ${model}` : "Auto";
}
/** Voice only dictates into the box; nothing runs until the user sends (Q70). */
export function dictation(draft: string, transcript: string) {
  const text = [draft.trimEnd(), transcript.trim()].filter(Boolean).join(" ");
  return { draft: text, send: false as const };
}

// ── First-run wizard (handoff §5, Q17) ───────────────────────────────────────
export const wizardSteps = [
  ["models", "AI and models", "Let’s power Firstmate"],
  ["tools", "Tools", "Which tools does your team use?"],
  ["work", "How you work", "What kind of work do you do?"],
  ["agents", "Agents", "Here are the agents I suggest"],
] as const;
export type WizardStep = (typeof wizardSteps)[number][0];
export const workCards = [
  ["product", "Products"],
  ["project", "Client delivery"],
  ["task", "Tasks"],
  ["rfp", "RFP tracking"],
] as const;
export const groupCards = ["Work", "Personal", "Side business"] as const;
export const providerCards = [
  ["openai-codex", "ChatGPT Plus/Pro"],
  ["anthropic", "Claude Pro/Max"],
  ["github-copilot", "GitHub Copilot"],
  ["openrouter", "OpenRouter"],
  ["xai", "xAI"],
  ["radius", "Radius"],
  ["api-key", "API key"],
] as const;
export const suggestedAgents = [
  { role: "Researcher", recommended: true },
  { role: "Analyst", recommended: true },
  { role: "Writer", recommended: true },
  { role: "Designer", recommended: false },
  { role: "QA", recommended: false },
  // No Engineer by default: Amun does not write production code (Q41).
] as const;

export interface WizardState {
  step: WizardStep;
  done: boolean;
  workTypes: string[];
  groups: {
    name: string;
    routes: { condition: string | null; tracker: string }[];
  }[];
  tools: string[];
  agents: string[];
}
export const initialWizard: WizardState = {
  step: "models",
  done: false,
  workTypes: [],
  groups: [],
  tools: [],
  agents: suggestedAgents
    .filter((agent) => agent.recommended)
    .map((agent) => agent.role),
};
export type WizardAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "toggle"; field: "workTypes" | "tools" | "agents"; value: string }
  | { type: "group"; name: string }
  | { type: "rename_group"; from: string; to: string }
  | { type: "route"; group: string; condition: string | null; tracker: string };
const order = wizardSteps.map(([id]) => id);
export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "next": {
      // Every step is skippable: setup only, it never starts work.
      const index = order.indexOf(state.step);
      return index === order.length - 1
        ? { ...state, done: true }
        : { ...state, step: order[index + 1]! };
    }
    case "back": {
      const index = order.indexOf(state.step);
      return index === 0 ? state : { ...state, step: order[index - 1]! };
    }
    case "toggle": {
      const list = state[action.field];
      return {
        ...state,
        [action.field]: list.includes(action.value)
          ? list.filter((value) => value !== action.value)
          : [...list, action.value],
      };
    }
    case "group": {
      const name = action.name.trim();
      if (!name) return state;
      return state.groups.some((group) => group.name === name)
        ? {
            ...state,
            groups: state.groups.filter((group) => group.name !== name),
          }
        : { ...state, groups: [...state.groups, { name, routes: [] }] };
    }
    case "rename_group": {
      const to = action.to.trim();
      if (!to || state.groups.some((group) => group.name === to)) return state;
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.name === action.from ? { ...group, name: to } : group,
        ),
      };
    }
    case "route":
      // A route is only ever recorded from the user's own choice.
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.name === action.group
            ? {
                ...group,
                routes: [
                  ...group.routes.filter(
                    (route) => route.condition !== action.condition,
                  ),
                  { condition: action.condition, tracker: action.tracker },
                ],
              }
            : group,
        ),
      };
  }
}
/** Groups left without a route stay unresolved and are asked when they first matter. */
export function unresolvedRoutes(state: WizardState) {
  return state.groups
    .filter((group) => !group.routes.length)
    .map((group) => group.name);
}
export function modelsLine(taskTypes: number) {
  return taskTypes
    ? `Models picked for ${taskTypes} task ${taskTypes === 1 ? "type" : "types"} · Review`
    : "Sign in to pick models";
}

/** Welcome cards for first use (handoff §6). Wording is [Proposed]. */
export const welcomeCards = [
  ["product", "Create a product", "Start a product and its roadmap"],
  ["idea", "Turn an idea into a brief", "From a thought to a one-page brief"],
  ["rfp", "Track an RFP", "Owners, deadline and outcome"],
  ["task", "Start a task", "Something to get done, with or without steps"],
] as const;

export const themeIds = [
  "tamer-sabry-default",
  "navy-gold",
  "navy-cyan",
  "amun-light",
] as const;
export type ThemeId = (typeof themeIds)[number];
/** Default follows macOS appearance; a manual choice in Settings overrides it (Q69). */
export function resolveTheme(input: {
  choice: ThemeId | "system";
  systemDark: boolean;
  lastDark?: ThemeId;
}): ThemeId {
  if (input.choice !== "system") return input.choice;
  return input.systemDark
    ? (input.lastDark ?? "tamer-sabry-default")
    : "amun-light";
}
