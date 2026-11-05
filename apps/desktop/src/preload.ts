import { ipcRenderer } from "electron";

ipcRenderer.on("amun-port", (event) => {
  const port = event.ports[0];
  if (port) window.postMessage({ kind: "amun-port" }, "*", [port]);
});
ipcRenderer.on("amun-status", (_event, status: unknown) => {
  if (status === "reconnecting")
    window.postMessage({ kind: "amun-status", status }, "*");
});
