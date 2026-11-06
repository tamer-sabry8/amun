import { ipcRenderer } from "electron";

ipcRenderer.on("amun-port", (event) => {
  const port = event.ports[0];
  if (port) window.postMessage({ kind: "amun-port" }, "*", [port]);
});
ipcRenderer.on("amun-status", (_event, status: unknown) => {
  if (status === "reconnecting")
    window.postMessage({ kind: "amun-status", status }, "*");
});

window.addEventListener("message", (event) => {
  if (event.source === window && event.data?.kind === "amun-browser-command")
    ipcRenderer.send("amun-browser", event.data.command);
});
ipcRenderer.on("amun-browser-status", (_event, message: unknown) => {
  if (typeof message === "string")
    window.postMessage({ kind: "amun-browser-status", message }, "*");
});

ipcRenderer.on("amun-browser-handoff", (_event, handoff: unknown) => {
  window.postMessage({ kind: "amun-browser-handoff", handoff }, "*");
});

window.addEventListener("message", (event) => {
  if (event.source === window && event.data?.kind === "amun-backup-command")
    ipcRenderer.send("amun-backup", event.data.command);
});
ipcRenderer.on("amun-backup-status", (_event, message: unknown) => {
  if (typeof message === "string")
    window.postMessage({ kind: "amun-backup-status", message }, "*");
});

ipcRenderer.on("amun-shell-shortcut", (_event, input: unknown) =>
  window.postMessage({ kind: "amun-shell-shortcut", input }, "*"),
);

window.addEventListener("message", (event) => {
  if (
    event.source === window &&
    event.data?.kind === "amun-pi-clipboard-command"
  )
    ipcRenderer.send("amun-pi-clipboard", event.data.command);
});
ipcRenderer.on("amun-pi-clipboard-status", (_event, result: unknown) => {
  window.postMessage({ kind: "amun-pi-clipboard-status", result }, "*");
});

window.addEventListener("message", (event) => {
  if (event.source === window && event.data?.kind === "amun-pi-export-command")
    ipcRenderer.send("amun-pi-export", event.data.command);
});
ipcRenderer.on("amun-pi-export-status", (_event, result: unknown) => {
  window.postMessage({ kind: "amun-pi-export-status", result }, "*");
});
