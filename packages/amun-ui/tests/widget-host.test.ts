import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WidgetRegistry,
  type WidgetKind,
} from "../../../packages/domain/src/widgets.ts";
import {
  PlainWidget,
  WidgetRenderers,
  WidgetSlot,
  type WidgetRenderProps,
} from "../src/widget-host.tsx";

const kind = (
  name: string,
  priority: number,
): WidgetKind<{ text: string }> => ({
  kind: name,
  slot: "activity",
  priority,
  schema: {
    safeParse: (input) => ({ success: true, data: input as { text: string } }),
  },
  title: (data) => data.text,
  actions: [{ id: "open", label: "Open run", primary: true }],
});

const setup = () => {
  const registry = new WidgetRegistry();
  registry.register(kind("run", 1));
  registry.register(kind("publication", 2));
  registry.propose({
    id: "w2",
    kind: "publication",
    productId: "p",
    data: { text: "Publishing 5/8" },
  });
  registry.propose({
    id: "w1",
    kind: "run",
    productId: "p",
    data: { text: "Engineer · Build signup" },
  });
  registry.propose({
    id: "w3",
    kind: "run",
    productId: "q",
    data: { text: "Other product" },
  });
  return registry;
};
const render = (
  registry: WidgetRegistry,
  renderers: WidgetRenderers,
  productId?: string,
) =>
  renderToStaticMarkup(
    createElement(WidgetSlot, {
      registry,
      renderers,
      slot: "activity",
      label: "Activity",
      ...(productId === undefined ? {} : { productId }),
    }),
  );

it("resolves a renderer by kind key, falls back to the plain card and refuses a second renderer", () => {
  const renderers = new WidgetRenderers();
  const custom = () => null;
  const dispose = renderers.register("run", custom);
  expect(renderers.resolve("run")).toBe(custom);
  expect(renderers.resolve("publication")).toBe(PlainWidget);
  expect(() => renderers.register("run", () => null)).toThrow(/already/);
  dispose();
  expect(renderers.has("run")).toBe(false);
  expect(renderers.resolve("run")).toBe(PlainWidget);
});

it("renders one product's open widgets in registry order with the registered renderer", () => {
  const registry = setup();
  const renderers = new WidgetRenderers();
  renderers.register("run", ({ widget }: WidgetRenderProps) =>
    createElement("div", { className: "run-tracker" }, widget.title),
  );
  const html = render(registry, renderers, "p");
  expect(html).toContain('data-widget-slot="activity"');
  expect(html).toContain('data-count="2"');
  expect(html).toContain(
    '<div class="run-tracker">Engineer · Build signup</div>',
  );
  expect(html).not.toContain("Other product");
  expect(html.indexOf("Build signup")).toBeLessThan(html.indexOf("Publishing"));
});

it("the plain card shows the title, each action and dismissal, and marks unavailable widgets", () => {
  const registry = new WidgetRegistry();
  const dispose = registry.register(kind("run", 1));
  registry.propose({
    id: "w1",
    kind: "run",
    productId: "p",
    data: { text: "Run" },
  });
  const renderers = new WidgetRenderers();
  let html = render(registry, renderers);
  expect(html).toContain('data-widget-kind="run"');
  expect(html).toContain(
    '<button type="button" class="primary">Open run</button>',
  );
  expect(html).toContain("Not now");
  expect(html).not.toContain("no longer available");
  dispose();
  html = render(registry, renderers);
  expect(html).toContain("no longer available");
  expect(html).not.toContain("Open run");
  registry.act("w1", "dismiss");
  expect(render(registry, renderers)).toContain('data-count="0"');
});
