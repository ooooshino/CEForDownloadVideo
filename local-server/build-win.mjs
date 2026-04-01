import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, "release-win");
const bundleFile = path.join(releaseDir, "server.cjs");
const binaryFile = path.join(releaseDir, "VideoExportLocalServer.exe");
const launcherFile = path.join(releaseDir, "启动本地视频服务.bat");
const readmeFile = path.join(releaseDir, "使用说明.txt");
const pkgBin = path.join(
  __dirname,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "pkg.cmd" : "pkg"
);

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

await build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  outfile: bundleFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  logLevel: "info"
});

await runPkg([
  bundleFile,
  "--targets",
  "node18-win-x64",
  "--output",
  binaryFile
]);

await writeFile(
  launcherFile,
  `@echo off
cd /d "%~dp0"
start "" VideoExportLocalServer.exe
`
);

await writeFile(
  readmeFile,
  [
    "双击“启动本地视频服务.bat”即可启动。",
    "如果浏览器插件已经装好，启动后就能直接导出。",
    "ffmpeg.exe 和 ffprobe.exe 需要跟这个文件放在同一个文件夹里。"
  ].join("\r\n")
);

console.log(`Windows executable ready: ${binaryFile}`);

async function runPkg(args) {
  if (process.platform === "win32") {
    await execFileAsync("cmd.exe", ["/c", pkgBin, ...args], {
      cwd: __dirname
    });
    return;
  }

  await execFileAsync(pkgBin, args, {
    cwd: __dirname
  });
}
