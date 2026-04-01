import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(__dirname, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: {
    "content-script": path.join(__dirname, "src/content-script.ts"),
    "service-worker": path.join(__dirname, "src/service-worker.ts"),
    "sidepanel": path.join(__dirname, "src/sidepanel.ts")
  },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir,
  sourcemap: true,
  logLevel: "info"
});

await Promise.all([
  cp(path.join(__dirname, "manifest.json"), path.join(outdir, "manifest.json")),
  cp(path.join(__dirname, "src/sidepanel.html"), path.join(outdir, "sidepanel.html")),
  cp(path.join(__dirname, "src/sidepanel.css"), path.join(outdir, "sidepanel.css")),
  cp(path.join(__dirname, "src/icons"), path.join(outdir, "icons"), { recursive: true })
]);

console.log(`Extension build complete: ${outdir}`);

