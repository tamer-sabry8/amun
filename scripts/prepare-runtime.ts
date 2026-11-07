import { resolve } from "node:path";
import {
  assertRuntimeContained,
  removeDeploymentSelfLink,
} from "../packages/crew/src/runtime-links.ts";
const runtime = process.argv[2] ?? "pi";
if (!["pi", "terminal", "database", "auth", "mcp"].includes(runtime))
  throw new Error("Unsupported runtime");
const staged = resolve(`apps/desktop/.runtime/${runtime}`);
await removeDeploymentSelfLink(
  staged,
  resolve(`runtime/${runtime}`),
  `${runtime}-runtime`,
);
await assertRuntimeContained(staged);
