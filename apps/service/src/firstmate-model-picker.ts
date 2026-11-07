import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import type { NativePiEvent } from "../../../packages/contracts/src/native-pi.ts";
import { FirstmateReleases } from "../../../packages/crew/src/firstmate-release.ts";
import { PiRpcClient } from "../../../packages/crew/src/pi-rpc.ts";
import { readBoundedPrivateFile } from "../../../packages/crew/src/endpoint-receipt.ts";
import { Redactor } from "../../../packages/security/src/redaction.ts";
import { runFirstmateCommand } from "./firstmate-calm.ts";
export class FirstmateModelPicker {
  private controller: AbortController | undefined;
  private waiting:
    | {
        turn: string;
        dialog: string;
        original: string;
        client: PiRpcClient;
        options: string[];
      }
    | undefined;
  answer(input: {
    id: string;
    dialog: string;
    answer: string | boolean | null;
  }) {
    const w = this.waiting;
    if (!w || w.turn !== input.id || w.dialog !== input.dialog) return false;
    if (
      input.answer !== null &&
      (typeof input.answer !== "string" || !w.options.includes(input.answer))
    )
      return true;
    this.waiting = undefined;
    w.client.answer(w.original, input.answer);
    return true;
  }
  close() {
    this.controller?.abort();
  }
  async open(
    turn: string,
    workspace: string,
    archives: string,
    binary: string,
    entry: string,
    authRoot: string,
    send: (r: NativePiEvent["result"]) => void,
  ) {
    if (this.controller) throw Error("Model selection pending");
    const controller = new AbortController();
    this.controller = controller;
    try {
      const releases = await FirstmateReleases.open(workspace, archives),
        { home, revision } = await releases.crewHome();
      await releases.verifyHomes(revision, [home]);
      const dir = join(home, "config");
      await mkdir(dir, { mode: 0o700, recursive: true });
      if ((await realpath(dir)) !== dir) throw Error("Invalid crew config");
      const redactor = new Redactor();
      await runFirstmateCommand(home, binary, entry, "supervision-model", {
        authRoot,
        signal: controller.signal,
        onFrame: (f, client) => {
          if (f.type !== "extension_ui_request") return;
          if (f.method === "notify" && f.notifyType === "error") {
            client.close();
            return;
          }
          if (f.method !== "select") return;
          if (
            typeof f.id !== "string" ||
            typeof f.title !== "string" ||
            !Array.isArray(f.options) ||
            f.options.length > 2048 ||
            !f.options.every(
              (s: unknown) =>
                typeof s === "string" &&
                s.length <= 256 &&
                s === redactor.text(s),
            )
          ) {
            client.close();
            return;
          }
          const dialog = randomUUID();
          this.waiting = {
            turn,
            dialog,
            original: f.id,
            options: f.options,
            client,
          };
          send({
            kind: "extension-dialog",
            method: "select",
            dialog,
            title: redactor.text(f.title).slice(0, 256),
            message: "",
            options: f.options,
          });
        },
      });
      const value = async (file: string) =>
        readBoundedPrivateFile(join(dir, file), 512)
          .then((s) => redactor.text(s.trim()))
          .catch((e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") return "follow main";
            throw e;
          });
      send({
        kind: "message",
        text:
          "Firstmate supervision model: " +
          (await value("supervision-branch-model")) +
          "\nReasoning effort: " +
          (await value("supervision-branch-effort")),
      });
    } finally {
      this.waiting = undefined;
      this.controller = undefined;
    }
  }
}
