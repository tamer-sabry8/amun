import { expect, it } from "vitest";
import { NativePiCredentials } from "../src/native-pi-credentials.ts";
it("requires a current service-issued confirmation before deleting a private provider credential", async () => {
  const removed: string[] = [];
  const session = {
    isStreaming: false,
    modelRuntime: {
      listCredentials: async () => [{ providerId: "openai" }],
      logout: async (provider: string) => {
        removed.push(provider);
      },
    },
  };
  const action = new NativePiCredentials(session);
  await expect(action.run("confirm:forged")).rejects.toThrow();
  expect((await action.run("")).kind).toBe("choices");
  const review = await action.run("openai");
  expect(removed).toEqual([]);
  if (review.kind !== "choices") throw Error("Missing review");
  expect(review.title).toContain("Amun");
  const receipt = review.choices[0]!.id;
  await action.run(receipt);
  expect(removed).toEqual(["openai"]);
  await expect(action.run(receipt)).rejects.toThrow();
});
it("rejects unknown, malformed and busy selections", async () => {
  const session = {
    isStreaming: false,
    modelRuntime: {
      listCredentials: async () => [{ providerId: "openai" }],
      logout: async () => {
        throw Error("Should not execute");
      },
    },
  };
  const action = new NativePiCredentials(session);
  await expect(action.run("personal-provider")).rejects.toThrow();
  await expect(action.run("\0")).rejects.toThrow();
  session.isStreaming = true;
  await expect(action.run("openai")).rejects.toThrow();
});
