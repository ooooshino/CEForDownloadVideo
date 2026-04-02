import { build } from "esbuild";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, "release-win");
const bundleFile = path.join(releaseDir, "server.cjs");
const binaryFile = path.join(releaseDir, "VideoExportLocalServer.exe");
const launcherFile = path.join(releaseDir, "启动本地视频服务.bat");
const readmeFile = path.join(releaseDir, "使用说明.txt");
const bundledToolDir = path.join(__dirname, "bin", "win32-x64");

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

await copyBundledTools();

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
    "命令查找顺序：FFMPEG_PATH / FFPROBE_PATH -> exe 同目录 -> local-server/bin -> 系统 PATH。",
    "如果你把 ffmpeg.exe 和 ffprobe.exe 放到 local-server/bin/win32-x64/，打包时会自动复制到 release-win。",
    "如果 release-win 里还没有这两个文件，也可以手动复制进去。"
  ].join("\r\n")
);

console.log(`Windows executable ready: ${binaryFile}`);

async function runPkg(args) {
  if (process.platform === "win32") {
    await execFileAsync("cmd.exe", ["/c", "npx", "pkg", ...args], {
      cwd: __dirname
    });
    return;
  }

  await execFileAsync("npx", ["pkg", ...args], {
    cwd: __dirname
  });
}

async function copyBundledTools() {
  for (const tool of ["ffmpeg.exe", "ffprobe.exe"]) {
    const source = path.join(bundledToolDir, tool);
    const target = path.join(releaseDir, tool);
    if (existsSync(source)) {
      await copyFile(source, target);
    }
  }
}
