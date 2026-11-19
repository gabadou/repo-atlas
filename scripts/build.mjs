// Bundles the viewer (three.js included) into dist/viewer.js, which atlas inlines into each map.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [path.join(home, "src/viewer/main.js")],
  outfile: path.join(home, "dist/viewer.js"),
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  legalComments: "none",
  logLevel: "warning",
});
console.log("Built dist/viewer.js");
