import {
  healthRequest,
  healthResponse,
  type HealthResponse,
} from "@amun/contracts";

export function handleHealthRequest(input: unknown): HealthResponse | null {
  const request = healthRequest.safeParse(input);
  if (!request.success) return null;
  return healthResponse.parse({
    version: 1,
    id: request.data.id,
    status: "ready",
  });
}
export function restartDelay(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0)
    throw new RangeError("Invalid restart attempt");
  return Math.min(100 * 2 ** Math.min(attempt, 5), 2000);
}
