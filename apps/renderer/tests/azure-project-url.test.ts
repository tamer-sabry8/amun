import { expect, it } from "vitest";
import { azureProjectUrl } from "../src/azure-project-url.ts";

it("accepts the project address and returns the plain form with its project", () => {
  expect(
    azureProjectUrl(" https://devops.tahaluf.ae/TahalufCollection/POCs/ "),
  ).toEqual({
    ok: true,
    url: "https://devops.tahaluf.ae/TahalufCollection/POCs",
    project: "POCs",
  });
  expect(
    azureProjectUrl("https://dev.azure.com/org/My%20Project"),
  ).toMatchObject({ ok: true, project: "My Project" });
});

it("explains each way an address cannot be used", () => {
  for (const bad of [
    "",
    "devops.tahaluf.ae/TahalufCollection/POCs",
    "http://devops.tahaluf.ae/TahalufCollection/POCs",
    "https://user:pw@devops.tahaluf.ae/C/P",
    "https://devops.tahaluf.ae/C/P?x=1",
    "https://devops.tahaluf.ae/C/P#top",
    "https://devops.tahaluf.ae/POCs",
    "https://devops.tahaluf.ae/C/%2E%2E",
    "https://devops.tahaluf.ae/C/%00",
  ]) {
    const result = azureProjectUrl(bad);
    expect(result.ok, bad).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(10);
  }
});
