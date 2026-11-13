// Pieces of the earlier shell that the rebuilt shell embeds. They load on
// first use, so startup does not pay for the earlier shell (memory budget).
import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";
import type { NativePiPanel as NativePiPanelView } from "../native-pi-panel.tsx";
import type { AgentsPanel as AgentsPanelView } from "../agents-panel.tsx";
import type { Backlog as BacklogView } from "../backlog.tsx";
import type { Settings as SettingsView } from "./settings.tsx";

function onDemand<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  const Loaded = lazy(load);
  return function OnDemand(props: P) {
    return (
      <Suspense
        fallback={
          <p className="muted" role="status">
            Opening…
          </p>
        }
      >
        <Loaded {...props} />
      </Suspense>
    );
  };
}

export const NativePiPanel = onDemand<ComponentProps<typeof NativePiPanelView>>(
  () =>
    import("../native-pi-panel.tsx").then((module) => ({
      default: module.NativePiPanel,
    })),
);
export const AgentsPanel = onDemand<ComponentProps<typeof AgentsPanelView>>(
  () =>
    import("../agents-panel.tsx").then((module) => ({
      default: module.AgentsPanel,
    })),
);
export const Backlog = onDemand<ComponentProps<typeof BacklogView>>(() =>
  import("../backlog.tsx").then((module) => ({ default: module.Backlog })),
);
export const Settings = onDemand<ComponentProps<typeof SettingsView>>(() =>
  import("./settings.tsx").then((module) => ({ default: module.Settings })),
);
