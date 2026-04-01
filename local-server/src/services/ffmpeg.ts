import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { createTempFilePath, getOutputPath, buildOutputFileName } from "../utils/files.js";
import { logInfo } from "../utils/logger.js";

export interface ProcessVideoInput {
  src: string;
  pageUrl: string;
  startTime: number;
  endTime: number;
  coverPath: string;
  downloadPath: string;
  jobDir: string;
  index: number;
}

interface ProbeInfo {
  duration: number;
  hasAudio: boolean;
  width: number;
  height: number;
}

interface OutputSize {
  width: number;
  height: number;
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
  const outputSize = resolveOutputSize(probe.width, probe.height);
  if (input.startTime >= probe.duration) {
    throw new Error(`开始秒数不能大于或等于视频总时长(${probe.duration.toFixed(2)}s)`);
  }

  const effectiveEndTime = Math.min(input.endTime, probe.duration);
  if (effectiveEndTime <= input.startTime) {
    throw new Error("结束秒数必须大于开始秒数");
  }

  const clipDuration = effectiveEndTime - input.startTime;
  const introDuration = 0.2;
  const finalDuration = clipDuration + introDuration;

  const introPath = createTempFilePath(input.jobDir, "intro.mp4");
  const normalizedPath = createTempFilePath(input.jobDir, "normalized.mp4");
  const concatListPath = createTempFilePath(input.jobDir, "concat.txt");
  const outputFilename = buildOutputFileName(input.pageUrl, input.index);
  const outputPath = getOutputPath(outputFilename);

  await createIntroClip(input.coverPath, introPath, introDuration, outputSize);
  await normalizeSource(
    input.downloadPath,
    normalizedPath,
    probe.hasAudio,
    outputSize,
    input.startTime,
    clipDuration
  );
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
    String(finalDuration),
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

async function createIntroClip(
  coverPath: string,
  outputPath: string,
  duration: number,
  outputSize: OutputSize
): Promise<void> {
  const args = [
    "-y",
    "-loop",
    "1",
    "-framerate",
    "30",
    "-i",
    coverPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t",
    String(duration),
    "-vf",
    `${buildScalePadFilter(outputSize)},fps=30`,
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

async function normalizeSource(
  inputPath: string,
  outputPath: string,
  hasAudio: boolean,
  outputSize: OutputSize,
  startTime: number,
  clipDuration: number
): Promise<void> {
  const args = [
    "-y",
    "-ss",
    String(startTime),
    "-i",
    inputPath,
    "-t",
    String(clipDuration)
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
    buildScalePadFilter(outputSize),
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
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_type,width,height",
    "-of",
    "csv=p=0",
    inputPath
  ]);

  const duration = Number.parseFloat(durationRaw.trim());
  const videoRow = streamsRaw
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  const [codecType, widthRaw, heightRaw] = (videoRow ?? "").split(",");
  const width = Number.parseInt(widthRaw, 10);
  const height = Number.parseInt(heightRaw, 10);

  const audioRaw = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    inputPath
  ]);

  const hasAudio = audioRaw
    .split("\n")
    .map((line) => line.trim())
    .includes("audio");

  if (!Number.isFinite(duration) || duration <= 0 || codecType !== "video" || !width || !height) {
    throw new Error("无法识别源视频时长");
  }

  return { duration, hasAudio, width, height };
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await resolveCommand(command);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommandSync(command), args);
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

async function resolveCommand(command: string): Promise<string> {
  return resolveCommandSync(command);
}

function resolveCommandSync(command: string): string {
  const candidates = [
    process.env[command === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"],
    path.join(path.dirname(process.execPath), command === "ffmpeg" ? executableName("ffmpeg") : executableName("ffprobe")),
    path.join(process.cwd(), command === "ffmpeg" ? executableName("ffmpeg") : executableName("ffprobe")),
    command
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === command || existsSync(candidate)) {
      return candidate;
    }
  }

  return command;
}

function executableName(command: "ffmpeg" | "ffprobe"): string {
  return process.platform === "win32" ? `${command}.exe` : command;
}

function escapeForConcat(filePath: string): string {
  return filePath.replaceAll("'", "'\\''");
}

function resolveOutputSize(width: number, height: number): OutputSize {
  if (height >= width) {
    const portraitHeight = toEven(height);
    const portraitWidth = toEven((portraitHeight * 9) / 16);
    return {
      width: portraitWidth,
      height: portraitHeight
    };
  }

  return {
    width: 720,
    height: 1280
  };
}

function buildScalePadFilter(outputSize: OutputSize): string {
  return buildFilterByOrientation(outputSize);
}

function toEven(value: number): number {
  const safe = Math.max(2, Math.round(value));
  return safe % 2 === 0 ? safe : safe - 1;
}

function buildFilterByOrientation(outputSize: OutputSize): string {
  const targetRatio = outputSize.width / outputSize.height;

  return [
    `scale='if(gte(iw/ih,${targetRatio}),-2,${outputSize.width})':'if(gte(iw/ih,${targetRatio}),${outputSize.height},-2)'`,
    `crop=${outputSize.width}:${outputSize.height}`,
    "setsar=1",
    "format=yuv420p"
  ].join(",");
}
