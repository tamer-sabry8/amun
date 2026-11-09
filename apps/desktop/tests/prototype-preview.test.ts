import { expect, it } from "vitest";
import { openPrototypePreview } from "../src/prototype-preview.ts";
it("serves only the scoped prototype, escapes designer content and refuses feedback on unknown elements", async () => {
  let active = true;
  const page = await openPrototypePreview(
    {
      title: "Review <example>",
      elements: [
        {
          id: "confirm",
          label: "Confirm",
          description: "<script>example</script>",
        },
      ],
    },
    () => active,
  );
  try {
    const response = await fetch(page.url);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("&lt;script&gt;");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    const base = new URL(page.url);
    expect((await fetch(base.origin + "/")).status).toBe(404);
    expect(
      (
        await fetch(page.url, {
          method: "POST",
          body: new URLSearchParams({
            element: "other",
            feedback: "change it",
          }),
          headers: { Origin: base.origin },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(page.url, {
          method: "POST",
          body: new URLSearchParams({
            element: "confirm",
            feedback: "Outside",
          }),
          headers: { Origin: "https://example.test" },
        })
      ).status,
    ).toBe(403);
    const pin = await fetch(page.url, {
      method: "POST",
      body: new URLSearchParams({
        element: "confirm",
        feedback: "Show confirmation",
      }),
      headers: { Origin: base.origin },
    });
    expect(pin.status).toBe(200);
    expect(page.pins()).toEqual([
      { element: "confirm", feedback: "Show confirmation" },
    ]);
    active = false;
    expect((await fetch(page.url)).status).toBe(404);
  } finally {
    await page.close();
  }
});
