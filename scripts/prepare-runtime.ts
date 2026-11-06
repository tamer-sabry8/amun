import { resolve } from "node:path";
import {
  assertRuntimeContained,
  removeDeploymentSelfLink,
} from "../packages/crew/src/runtime-links.ts";
const staged = resolve("apps/desktop/.runtime/pi");
await removeDeploymentSelfLink(staged, resolve("runtime/pi"));
await assertRuntimeContained(staged);
