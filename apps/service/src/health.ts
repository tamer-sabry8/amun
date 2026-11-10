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
export { restartDelay } from "./restart-delay.ts";
