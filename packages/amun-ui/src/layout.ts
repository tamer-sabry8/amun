export type Drawer =
  "notifications" | "activity" | "artifacts" | "downloads" | "skills";
export type IslandSize = "rail" | "pill" | "card" | "expanded";
export interface Layout {
  focus: boolean;
  inspector: "issue" | "web" | null;
  drawer: Drawer | null;
  pinned: boolean;
  island: IslandSize;
  terminal: boolean;
  saved: Layout | null;
}
export const initialLayout: Layout = {
  focus: false,
  inspector: null,
  drawer: null,
  pinned: false,
  island: "card",
  terminal: false,
  saved: null,
};
export type LayoutAction =
  | { type: "focus" | "leave" | "close" | "terminal" | "data" }
  | { type: "hover" | "pin"; drawer: Drawer }
  | { type: "inspect"; tab: "issue" | "web" | null }
  | { type: "island"; size: IslandSize };
export function layoutReducer(state: Layout, action: LayoutAction): Layout {
  if (action.type === "focus")
    return state.focus
      ? (state.saved ?? initialLayout)
      : {
          ...state,
          focus: true,
          inspector: null,
          drawer: null,
          pinned: false,
          island: "rail",
          saved: state,
        };
  if (action.type === "data") return state;
  if (action.type === "terminal")
    return { ...state, terminal: !state.terminal };
  if (state.focus) return state;
  if (action.type === "inspect") return { ...state, inspector: action.tab };
  if (action.type === "island") return { ...state, island: action.size };
  if (action.type === "close") return { ...state, drawer: null, pinned: false };
  if (action.type === "leave")
    return state.pinned ? state : { ...state, drawer: null };
  if (action.type === "hover")
    return state.pinned
      ? state
      : { ...state, drawer: action.drawer, pinned: false };
  if (action.type === "pin")
    return state.pinned && state.drawer === action.drawer
      ? { ...state, drawer: null, pinned: false }
      : { ...state, drawer: action.drawer, pinned: true };
  return state;
}
