// Heavier views of the rebuilt shell. They load on first use, so startup does
// not pay for them (memory budget).
import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";
import type { Backlog as BacklogView } from "./backlog-view.tsx";
import type { PrdView as PrdViewType } from "./prd-view.tsx";
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

export const Backlog = onDemand<ComponentProps<typeof BacklogView>>(() =>
  import("./backlog-view.tsx").then((module) => ({ default: module.Backlog })),
);
export const PrdView = onDemand<ComponentProps<typeof PrdViewType>>(() =>
  import("./prd-view.tsx").then((module) => ({ default: module.PrdView })),
);
export const Settings = onDemand<ComponentProps<typeof SettingsView>>(() =>
  import("./settings.tsx").then((module) => ({ default: module.Settings })),
);
