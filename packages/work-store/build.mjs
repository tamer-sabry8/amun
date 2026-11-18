// Builds the two files the daemon loads: the work store (with the Council and
// the Notion connection bundled in) and the Council's owner-question helper.
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["node:*"],
};

await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  // Some bundled libraries are CommonJS and call require() for Node's own
  // modules; an ES module has no require unless it is made here.
  banner: {
    js: 'import { createRequire as amunCreateRequire } from "node:module";\nconst require = amunCreateRequire(import.meta.url);',
  },
});
await build({
  ...shared,
  entryPoints: ["../council/src/ask-server-main.ts"],
  outfile: "dist/council-ask-server.js",
});
