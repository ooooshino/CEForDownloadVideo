import { build } from "esbuild";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, "release");
const bundleFile = path.join(releaseDir, "server.cjs");
const blobFile = path.join(releaseDir, "server.blob");
const seaConfigFile = path.join(releaseDir, "sea-config.json");
const binaryFile = path.join(releaseDir, "VideoExportLocalServer");
const launcherFile = path.join(releaseDir, "启动本地视频服务.command");
const postjectBin = path.join(__dirname, "node_modules", ".bin", "postject");

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

await build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: false,
  logLevel: "info"
});

await writeFile(
  seaConfigFile,
  JSON.stringify(
    {
      main: bundleFile,
      output: blobFile,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false
    },
    null,
    2
  )
);

await execFileAsync(process.execPath, ["--experimental-sea-config", seaConfigFile], {
  cwd: __dirname
});

await copyFile(process.execPath, binaryFile);
await tryExec("codesign", ["--remove-signature", binaryFile]);
await execFileAsync(postjectBin, [
  binaryFile,
  "NODE_SEA_BLOB",
  blobFile,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  "--macho-segment-name",
  "NODE_SEA"
]);
await tryExec("codesign", ["--sign", "-", binaryFile]);
await chmod(binaryFile, 0o755);

await writeFile(
  launcherFile,
  `#!/bin/zsh
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
./VideoExportLocalServer
`
);
await chmod(launcherFile, 0o755);

console.log(`Executable ready: ${binaryFile}`);
console.log(`Double-click launcher ready: ${launcherFile}`);

async function tryExec(command, args) {
  try {
    await execFileAsync(command, args, { cwd: __dirname });
  } catch {
    // ignore local codesign differences
  }
}
