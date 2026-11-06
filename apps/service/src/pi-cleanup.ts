import { basename, dirname, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
/** Emit only an app-authored cleanup extension for an exclusively allocated temporary root. */
export function cleanupExtension(root: string): string {
  const parents = new Set([
    resolve(tmpdir()),
    realpathSync(tmpdir()),
    "/tmp",
    "/private/tmp",
  ]);
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    /[\0\r\n]/.test(root) ||
    !parents.has(dirname(root)) ||
    !/^amun-pi-service-[A-Za-z0-9]{6}$/.test(basename(root))
  )
    throw new Error("Unsafe Pi cleanup root");
  return `import {rmSync} from "node:fs";
const root=${JSON.stringify(root)};
const cleanup=()=>{try{rmSync(root,{recursive:true,force:true});}catch{}};
export default function(pi){
 process.stdin.once("end",()=>{cleanup();process.exit(0);});
 process.once("exit",cleanup);
 pi.on("session_shutdown",cleanup);
}`;
}
