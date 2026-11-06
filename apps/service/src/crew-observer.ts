import {
  crewObserve,
  crewObservation,
} from "../../../packages/contracts/src/crew.ts";
export class CrewObserver {
  private closed = false;
  private busy = false;
  constructor(
    private read: (id: string) => Promise<unknown>,
    private send: (result: unknown) => void,
  ) {}
  async handle(input: unknown): Promise<void> {
    const request = crewObserve.safeParse(input);
    if (!request.success || this.closed || this.busy) return;
    this.busy = true;
    let endpoint: "verified" | "unknown" = "unknown";
    try {
      const result = await this.read(request.data.taskId);
      if (
        result &&
        typeof result === "object" &&
        "endpoint" in result &&
        result.endpoint === "verified"
      )
        endpoint = "verified";
    } catch {
      /* Failed identity/liveness is unknown, never a reason to spawn. */
    } finally {
      this.busy = false;
    }
    if (!this.closed)
      this.send(
        crewObservation.parse({
          version: 1,
          kind: "crew-observation",
          taskId: request.data.taskId,
          endpoint,
          worker: "unknown",
        }),
      );
  }
  close(): void {
    this.closed = true;
  }
}
