/**
 * Element feedback: what a person selected in a preview, cleaned and masked
 * before it is shown to an agent. The page it comes from is untrusted, so
 * every field is bounded and nothing here is executed.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementCapture {
  /** Address of the previewed page. Query strings are dropped. */
  url: string;
  selector: string;
  /** The element's visible label or accessible name. */
  label: string;
  role?: string;
  text?: string;
  rect: Rect;
  viewport: { width: number; height: number };
  /** Computed styles relevant to layout and appearance. */
  styles?: Readonly<Record<string, string>>;
  /** Accessibility findings for the element, in plain words. */
  accessibility?: readonly string[];
  consoleErrors?: readonly string[];
  networkFailures?: readonly string[];
  /** Reference to a stored screenshot; image bytes are never inlined. */
  screenshotRef?: string;
  /** Labels of nearby elements, for surrounding context. */
  nearby?: readonly string[];
}

export interface Mask {
  /** Area of the screenshot to blur, in page coordinates. */
  rect?: Rect;
  /** Exact text to hide wherever it appears. */
  text?: string;
}

export const feedbackPurposes = ["bug", "design"] as const;
export type FeedbackPurpose = (typeof feedbackPurposes)[number];

const styleNames = new Set([
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "border",
  "border-radius",
  "overflow",
  "z-index",
  "opacity",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "text-align",
  "box-shadow",
  "outline",
]);

const hidden = "[hidden]";

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function lines(values: unknown, max: number, each: number): string[] {
  return Array.isArray(values)
    ? values
        .filter((value): value is string => typeof value === "string")
        .slice(0, max)
        .map((value) => value.slice(0, each))
    : [];
}

function rect(value: unknown): Rect {
  const r = (value ?? {}) as Partial<Rect>;
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(-100000, Math.min(100000, Math.round(v)))
      : 0;
  return {
    x: n(r.x),
    y: n(r.y),
    width: Math.max(0, n(r.width)),
    height: Math.max(0, n(r.height)),
  };
}

function pageAddress(value: unknown): string {
  try {
    const url = new URL(clip(value, 2048));
    if (!["http:", "https:", "file:"].includes(url.protocol)) return "";
    return url.origin === "null"
      ? url.protocol + "//" + url.pathname
      : url.origin + url.pathname;
  } catch {
    return "";
  }
}

/** Bounds and cleans a capture received from a preview page. */
export function sanitizeCapture(input: unknown): ElementCapture {
  const raw = (input ?? {}) as Record<string, unknown>;
  const selector = clip(raw.selector, 512).trim();
  if (!selector) throw Error("Select an element first");
  const box = rect(raw.rect);
  if (box.width === 0 || box.height === 0)
    throw Error("The selected element is not visible");
  const viewport = rect({ ...(raw.viewport as object), x: 0, y: 0 });
  const styles: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    (raw.styles ?? {}) as Record<string, unknown>,
  ))
    if (styleNames.has(name) && typeof value === "string")
      styles[name] = value.slice(0, 200);
  const screenshot = clip(raw.screenshotRef, 256);
  return {
    url: pageAddress(raw.url),
    selector,
    label: clip(raw.label, 200).trim() || selector,
    ...(clip(raw.role, 64) ? { role: clip(raw.role, 64) } : {}),
    ...(clip(raw.text, 1000) ? { text: clip(raw.text, 1000) } : {}),
    rect: box,
    viewport: { width: viewport.width, height: viewport.height },
    styles,
    accessibility: lines(raw.accessibility, 20, 300),
    consoleErrors: lines(raw.consoleErrors, 20, 500),
    networkFailures: lines(raw.networkFailures, 20, 300),
    // Only an opaque local reference is accepted, never a data: URL.
    ...(/^[A-Za-z0-9._/-]+$/.test(screenshot)
      ? { screenshotRef: screenshot }
      : {}),
    nearby: lines(raw.nearby, 12, 120),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Applies a person's masks before anything is shared. Masked text is hidden
 * everywhere it appears. If a masked area overlaps the element, its text and
 * screenshot are withheld, because a crop would still show the area.
 */
export function applyMasks(
  capture: ElementCapture,
  masks: readonly Mask[],
): ElementCapture & { maskedAreas: Rect[] } {
  const words = masks
    .map((mask) => mask.text ?? "")
    .filter((text) => text.length > 0)
    .sort((a, b) => b.length - a.length);
  const scrub = (value: string) =>
    words.reduce((text, word) => text.split(word).join(hidden), value);
  const areas = masks
    .map((mask) => mask.rect)
    .filter((area): area is Rect => area !== undefined)
    .map(rect);
  const covered = areas.some((area) => intersects(area, capture.rect));
  const { screenshotRef, text, ...rest } = capture;
  return {
    ...rest,
    label: covered ? hidden : scrub(capture.label),
    ...(text !== undefined ? { text: covered ? hidden : scrub(text) } : {}),
    ...(screenshotRef !== undefined && !covered ? { screenshotRef } : {}),
    consoleErrors: (capture.consoleErrors ?? []).map(scrub),
    networkFailures: (capture.networkFailures ?? []).map(scrub),
    accessibility: (capture.accessibility ?? []).map(scrub),
    nearby: (capture.nearby ?? []).map(scrub),
    maskedAreas: areas,
  };
}

/** Where the element sits in the viewport, in words. */
export function describePosition(capture: ElementCapture): string {
  const { rect: r, viewport: v } = capture;
  if (v.width === 0 || v.height === 0)
    return `${r.width}×${r.height} at ${r.x},${r.y}`;
  const cx = (r.x + r.width / 2) / v.width;
  const cy = (r.y + r.height / 2) / v.height;
  const horizontal = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "centre";
  const vertical = cy < 1 / 3 ? "top" : cy > 2 / 3 ? "bottom" : "middle";
  const outside =
    r.x < 0 || r.y < 0 || r.x + r.width > v.width || r.y + r.height > v.height;
  return (
    `${r.width}×${r.height} at ${r.x},${r.y}, ${vertical} ${horizontal} of a ${v.width}×${v.height} view` +
    (outside ? ", extending past the visible area" : "")
  );
}

/**
 * The message an agent receives. It asks the agent to name the element and
 * state its plan before changing anything broad.
 */
export function feedbackMessage(
  capture: ReturnType<typeof applyMasks>,
  intent: string,
  purpose: FeedbackPurpose,
): string {
  const wanted = intent.trim();
  if (!wanted) throw Error("Say what you want changed");
  const section = (title: string, items: readonly string[]) =>
    items.length ? [title + ":", ...items.map((item) => "- " + item)] : [];
  return [
    purpose === "bug"
      ? "Bug report on one element"
      : "Design feedback on one element",
    "",
    "Wanted: " + wanted.slice(0, 2000),
    "Element: " + capture.label + (capture.role ? ` (${capture.role})` : ""),
    "Selector: " + capture.selector,
    ...(capture.url ? ["Page: " + capture.url] : []),
    "Position: " + describePosition(capture),
    ...(capture.text ? ["Visible text: " + capture.text] : []),
    ...(capture.screenshotRef ? ["Screenshot: " + capture.screenshotRef] : []),
    ...(capture.maskedAreas.length
      ? [
          `${capture.maskedAreas.length} area was masked by the user and is not shown.`,
        ]
      : []),
    ...section(
      "Styles",
      Object.entries(capture.styles ?? {}).map(([k, v]) => `${k}: ${v}`),
    ),
    ...section("Nearby", capture.nearby ?? []),
    ...section("Accessibility", capture.accessibility ?? []),
    ...section("Console errors", capture.consoleErrors ?? []),
    ...section("Network failures", capture.networkFailures ?? []),
    "",
    "Before changing anything, name this element and say what you will change. Keep the change to this element unless you explain why more is needed.",
  ].join("\n");
}

export interface CaptureChange {
  field: string;
  before: string;
  after: string;
}

/** What differs between the element before and after a change. */
export function compareCaptures(
  before: ElementCapture,
  after: ElementCapture,
): { changes: CaptureChange[]; errorsFixed: string[]; errorsNew: string[] } {
  const changes: CaptureChange[] = [];
  const add = (field: string, a: string, b: string) => {
    if (a !== b) changes.push({ field, before: a, after: b });
  };
  add("text", before.text ?? "", after.text ?? "");
  add(
    "size",
    `${before.rect.width}×${before.rect.height}`,
    `${after.rect.width}×${after.rect.height}`,
  );
  add(
    "position",
    `${before.rect.x},${before.rect.y}`,
    `${after.rect.x},${after.rect.y}`,
  );
  const names = new Set([
    ...Object.keys(before.styles ?? {}),
    ...Object.keys(after.styles ?? {}),
  ]);
  for (const name of [...names].sort())
    add(name, before.styles?.[name] ?? "", after.styles?.[name] ?? "");
  const was = [
    ...(before.consoleErrors ?? []),
    ...(before.networkFailures ?? []),
  ];
  const now = [
    ...(after.consoleErrors ?? []),
    ...(after.networkFailures ?? []),
  ];
  return {
    changes,
    errorsFixed: was.filter((error) => !now.includes(error)),
    errorsNew: now.filter((error) => !was.includes(error)),
  };
}
