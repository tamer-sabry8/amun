import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rename, rm, writeFile } from "node:fs/promises";
import { readBoundedPrivateFile } from "./endpoint-receipt.ts";
import { llamaCatalog } from "../../contracts/src/native-pi.ts";

export function localRouterUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/v1", "/v1/"].includes(url.pathname)
  )
    throw Error("Choose a loopback llama.cpp router URL");
  return url.origin;
}
async function request(base: string, path: string, model?: string) {
  const response = await fetch(base + path, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    ...(model
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model }),
        }
      : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("Router refused the request");
  }
  if (model) {
    await response.body?.cancel();
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty catalog");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1048576) throw Error("Catalog too large");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
}
export class NativeLlamaRouter {
  private ticket:
    | { id: string; url: string; models: { id: string; status: string }[] }
    | undefined;
  constructor(private root: string) {}
  private async list(url: string) {
    const catalog = llamaCatalog.parse(await request(url, "/models"));
    const models = catalog.data.map((m) => ({
      id: m.id,
      status: m.status.value,
    }));
    if (new Set(models.map((m) => m.id)).size !== models.length)
      throw Error("Ambiguous model identities");
    return models;
  }
  async run(argument: string) {
    const binding = join(this.root, "llama-router-url");
    const action = /^(load|unload) ([a-f0-9-]{36}) (\d{1,3})$/.exec(argument);
    const previous = this.ticket;
    this.ticket = undefined;
    let url: string;
    if (action) {
      if (!previous || previous.id !== action[2])
        throw Error("Refresh the router first");
      url = previous.url;
      const model = previous.models[Number(action[3])];
      if (!model) throw Error("Unknown model");
      const current = await this.list(url),
        live = current.find((m) => m.id === model.id);
      if (live?.status !== model.status) throw Error("Router changed");
      if (
        action[1] === "load" &&
        (live.status !== "unloaded" ||
          current.some((m) => m.id !== model.id && m.status !== "unloaded"))
      )
        throw Error("Unload the active model first");
      if (
        action[1] === "unload" &&
        !["loaded", "sleeping"].includes(live.status)
      )
        throw Error("Model is not loaded");
      await request(url, "/models/" + action[1], model.id);
      const desired = action[1] === "load" ? "loaded" : "unloaded",
        deadline = Date.now() + 90000;
      while (
        !(await this.list(url)).some(
          (m) => m.id === model.id && m.status === desired,
        )
      ) {
        if (Date.now() > deadline) throw Error("Timed out waiting for model");
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      const saved =
        argument ||
        (await readBoundedPrivateFile(binding, 2048).catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") return "http://127.0.0.1:8080";
            throw e;
          },
        ));
      url = localRouterUrl(saved);
    }
    const models = await this.list(url);
    if (argument && !action) {
      const temp = binding + "-" + randomUUID();
      try {
        await writeFile(temp, url, { flag: "wx", mode: 0o600, flush: true });
        await rename(temp, binding);
      } finally {
        await rm(temp, { force: true });
      }
    }
    const id = randomUUID();
    this.ticket = { url, models, id };
    return { kind: "llama-router" as const, url, models, ticket: id };
  }
}
