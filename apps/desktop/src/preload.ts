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
