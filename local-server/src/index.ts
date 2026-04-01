import cors from "cors";
import express from "express";
import { exportRouter } from "./routes/export.js";
import { SERVER_HOST, SERVER_PORT } from "./config.js";
import { checkFfmpegInstalled } from "./services/ffmpeg.js";
import { ensureBaseDirs } from "./utils/files.js";
import { logError, logInfo } from "./utils/logger.js";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin.startsWith("chrome-extension://") || origin === "http://127.0.0.1:37891") {
        callback(null, true);
        return;
      }
      callback(new Error("CORS blocked"));
    }
  })
);

app.get("/health", async (_req, res) => {
  const tools = await checkFfmpegInstalled();
  res.json({
    ok: tools.ffmpeg && tools.ffprobe,
    ffmpeg: tools.ffmpeg,
    ffprobe: tools.ffprobe
  });
});

app.use("/export", exportRouter);

async function main(): Promise<void> {
  await ensureBaseDirs();

  app.listen(SERVER_PORT, SERVER_HOST, () => {
    logInfo(`Local server ready at http://${SERVER_HOST}:${SERVER_PORT}`);
  });
}

main().catch((error) => {
  logError("Server failed to start", error);
  process.exit(1);
});

