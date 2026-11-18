// Files and screenshots added to a conversation draft. Each one is read on
// the Mac by the service, filed in the work area's library, and travels with
// the next message. Nothing here is shown in the prompt box beyond the file
// name it already shows.
import { useEffect, useRef, useState } from "react";
import { workAttachmentResult } from "../../../../packages/contracts/src/work.ts";
import { bridge } from "../bridge.ts";
import { pastedImage } from "../pasted-image.ts";

export interface Attached {
  id: string;
  name: string;
  state: "reading" | "ready";
  read: "all" | "part" | "none";
  portion: number | null;
  /** Text for Firstmate. */
  text: string;
  /** An image a model can look at (base64 PNG). */
  image: string | null;
  /** The owner has answered the card about this file. */
  settled: boolean;
}

/** "about a quarter", for a share of a file that was read. */
export function portionWords(portion: number | null) {
  if (portion === null) return "part";
  if (portion < 0.17) return "a small part";
  if (portion < 0.29) return "about a quarter";
  if (portion < 0.42) return "about a third";
  if (portion < 0.58) return "about half";
  if (portion < 0.71) return "about two thirds";
  if (portion < 0.86) return "about three quarters";
  return "most";
}

/** What Firstmate receives for the attached files, after the user's words. */
export function attachmentBlock(files: Attached[]) {
  return files
    .map((file) =>
      file.read === "none"
        ? `[Attached file: ${file.name} — could not be read]`
        : `[Attached file: ${file.name}${file.read === "part" ? ` — only ${portionWords(file.portion)} of it was read` : ""}]\n${file.text}`,
    )
    .join("\n\n");
}

export function useAttachments(workAreaId: string) {
  const [files, setFiles] = useState<Attached[]>([]);
  const current = useRef(files);
  current.current = files;
  const patch = (id: string, change: Partial<Attached>) =>
    setFiles((list) =>
      list.map((file) => (file.id === id ? { ...file, ...change } : file)),
    );
  useEffect(() => {
    setFiles([]);
    return bridge.onEvent((raw) => {
      const event = workAttachmentResult.safeParse(raw);
      if (!event.success) return;
      patch(event.data.requestId, {
        state: "ready",
        read: event.data.read,
        portion: event.data.portion,
        text: event.data.text,
      });
    });
  }, [workAreaId]);

  const add = (picked: File[]) => {
    for (const file of picked) {
      // A file already in the draft is not read twice.
      if (current.current.some((item) => item.name === file.name)) continue;
      const id = crypto.randomUUID();
      setFiles((list) => [
        ...list,
        {
          id,
          name: file.name,
          state: "reading",
          read: "all",
          portion: null,
          text: "",
          image: null,
          settled: false,
        },
      ]);
      if (file.type.startsWith("image/"))
        void pastedImage(file)
          .then((image) => patch(id, { image }))
          .catch(() => undefined);
      void file.arrayBuffer().then((buffer) =>
        bridge.send({
          version: 1,
          kind: "work-attachment",
          requestId: id,
          workAreaId,
          name: file.name,
          bytes: new Uint8Array(buffer),
        }),
      );
    }
  };
  const remove = (name: string) =>
    setFiles((list) => list.filter((file) => file.name !== name));
  const settle = (id: string) => patch(id, { settled: true });
  /** Resolves once every file has been read, then empties the draft. */
  const take = async () => {
    for (let waited = 0; waited < 120; waited++) {
      if (current.current.every((file) => file.state === "ready")) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const ready = current.current;
    setFiles([]);
    return ready;
  };
  /** Starts the Mac's area selection; the capture joins this draft. */
  const screenshot = () => {
    const id = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data?.kind !== "amun-screenshot-result" ||
        event.data.result?.id !== id
      )
        return;
      window.removeEventListener("message", receive);
      const bytes = event.data.result.bytes as Uint8Array | null;
      // Cancelled: the draft stays exactly as it was.
      if (!bytes?.length) return;
      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      add([
        new File([new Uint8Array(bytes)], `Screenshot ${time}.png`, {
          type: "image/png",
        }),
      ]);
    };
    window.addEventListener("message", receive);
    window.postMessage({ kind: "amun-screenshot", id }, "*");
  };
  return {
    files,
    /** The file the owner should be told about next, if any. */
    problem:
      files.find(
        (file) =>
          file.state === "ready" && file.read !== "all" && !file.settled,
      ) ?? null,
    add,
    remove,
    settle,
    take,
    screenshot,
  };
}
