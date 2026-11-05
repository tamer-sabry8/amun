import { handleHealthRequest } from "../../service/src/health.js";

process.parentPort?.on("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  port.on("message", (message) => {
    const response = handleHealthRequest(message.data);
    if (response) port.postMessage(response);
  });
  port.start();
});
