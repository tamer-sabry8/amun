# Pi request correlation and dialog transport

M0 / T006. `rpc-client-red.log` records the initial nine failing tests before implementation. `rpc-client-green.log` records twelve passing tests, including additional bounds and fail-closed cases.

The service-side client uses bounded LF-only JSON framing, unique request IDs, command matching, at most 64 pending commands, explicit timeouts, and disconnect cleanup. It does not retry uncertain commands. Runtime failure bodies and malformed JSON contents are excluded from errors. A successful prompt acknowledgement is not completion of the agent run; stream events are delivered separately.

Select/confirm requests wait for an explicit matching answer, validate the value, accept it once, and expire with cancellation. Unsupported input/editor requests are cancelled. Duplicate interactive IDs close the protocol. Dialog confirmation is a transport response, not an Amun governed-action approval. Renderer IPC/UI and governance integration remain pending; raw runtime events must not be forwarded directly to renderer IPC.

The live `scripts/pi-proof.ts` now uses this client for get_state/get_available_models, including packaged execution. Source proof passed with normal managed runtime access; the restricted sandbox child exited before replies, so that environment result is not counted as a pass. Local lint, typecheck, formatting and all 102 unit tests passed.

Remaining: real authenticated provider streaming, renderer dialog integration, approved provider sign-in/readiness evidence, and worker lifecycle. No provider credentials or model calls were used. Listing available model metadata is not proof of authenticated access. T006 remains open.
