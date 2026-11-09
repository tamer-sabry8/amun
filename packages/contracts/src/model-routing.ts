import { z } from "zod";
export const routeTask = z.enum([
  "conversation",
  "authoring",
  "stories",
  "decision",
]);
export const difficulty = z.enum(["standard", "complex"]);
export const modelRoute = z.strictObject({
  task: routeTask,
  difficulty,
  model: z.string().trim().min(1).max(256),
});
export const routingReview = modelRoute.extend({
  id: z.uuid(),
  binding: z.string().length(64),
});
export type Route = z.infer<typeof modelRoute>;
