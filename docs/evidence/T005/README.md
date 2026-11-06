# T005 — Service transport and recovery

Unit red: 6 failed, 4 passed before the health handler and bounded restart delay existed. Unit green: 45 tests pass across the workspace; lint, strict types and formatting also pass. See red.log and green.log. Implementation and evidence are versioned together.

The desktop creates a utilityProcess and transfers a MessagePort to each loaded window through a minimal sandbox preload. The renderer validates the health response and correlation ID; the service validates requests. No TCP endpoint or arbitrary command method is exposed. On service exit the window shows Reconnecting, pending UI ports close, and a replacement process receives fresh ports. Retries back off from 100 ms to 2 s and reset only after ten stable seconds. App quit cancels retries and kills the child.

The macOS E2E kills the real utility process, requires an observed Reconnecting state, then a fresh successful health response within five seconds. Its CI result is required before closing T005. This proof does not persist or reattach worker runs (T008).
