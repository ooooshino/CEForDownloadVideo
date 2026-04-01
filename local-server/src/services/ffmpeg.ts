import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createTempFilePath, getOutputPath, buildOutputFileName } from "../utils/files.js";
import { logInfo } from "../utils/logger.js";

export interface ProcessVideoInput {
  src: string;
  pageUrl: string;
  duration: number;
  coverPath: string;
  downloadPath: string;
  jobDir: string;
  index: number;
}

interface ProbeInfo {
  duration: number;
  hasAudio: boolean;
}

export async function checkFfmpegInstalled(): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
  const ffmpeg = await commandAvailable("ffmpeg");
  const ffprobe = await commandAvailable("ffprobe");
  return { ffmpeg, ffprobe };
}

export async function processVideo(input: ProcessVideoInput): Promise<string> {
  const tools = await checkFfmpegInstalled();
  if (!tools.ffmpeg) {
    throw new Error("系统里找不到 ffmpeg，请先安装 ffmpeg");
  }
  if (!tools.ffprobe) {
    throw new Error("系统里找不到 ffprobe，请先安装 ffprobe");
  }

  const probe = await probeVideo(input.downloadPath);
  const introDuration = Math.min(1, input.duration);
  const mainDurationBudget = Math.max(input.duration - introDuration, 0);
  const padSeconds = Math.max(mainDurationBudget - probe.duration, 0);

  const introPath = createTempFilePath(input.jobDir, "intro.mp4");
  const normalizedPath = createTempFilePath(input.jobDir, "normalized.mp4");
  const concatListPath = createTempFilePath(input.jobDir, "concat.txt");
  const outputFilename = buildOutputFileName(input.pageUrl, input.index);
  const outputPath = getOutputPath(outputFilename);

  await createIntroClip(input.coverPath, introPath, introDuration);
  await normalizeSource(input.downloadPath, normalizedPath, probe.hasAudio);
  await writeFile(
    concatListPath,
    `file '${escapeForConcat(introPath)}'\nfile '${escapeForConcat(normalizedPath)}'\n`,
    "utf8"
  );

  const concatArgs = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-t",
    String(input.duration),
    "-vf",
    `tpad=stop_mode=clone:stop_duration=${padSeconds.toFixed(3)}`,
    "-af",
    "apad",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];

  logInfo("Running ffmpeg export", { src: input.src, args: concatArgs });
  await runCommand("ffmpeg", concatArgs);
  return outputPath;
}

async function createIntroClip(coverPath: string, outputPath: string, duration: number): Promise<void> {
  const args = [
    "-y",
    "-loop",
    "1",
    "-i",
    coverPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t",
    String(duration),
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-shortest",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    outputPath
  ];
  await runCommand("ffmpeg", args);
}

async function normalizeSource(inputPath: string, outputPath: string, hasAudio: boolean): Promise<void> {
  const args = [
    "-y",
    "-i",
    inputPath
  ];

  if (!hasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }

  args.push(
    "-map",
    "0:v:0",
    "-map",
    hasAudio ? "0:a:0" : "1:a:0",
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    "-shortest",
    outputPath
  );

  await runCommand("ffmpeg", args);
}

async function probeVideo(inputPath: string): Promise<ProbeInfo> {
  const durationRaw = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath
  ]);

  const streamsRaw = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    inputPath
  ]);

  const duration = Number.parseFloat(durationRaw.trim());
  const hasAudio = streamsRaw
    .split("\n")
    .map((line) => line.trim())
    .includes("audio");

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("无法识别源视频时长");
  }

  return { duration, hasAudio };
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await runCommand("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout || stderr);
        return;
      }
      reject(new Error(`${command} 执行失败(${code}): ${stderr || stdout}`));
    });
  });
}

function escapeForConcat(filePath: string): string {
  return filePath.replaceAll("'", "'\\''");
}
