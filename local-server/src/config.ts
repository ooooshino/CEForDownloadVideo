import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export const SERVER_PORT = 37891;
export const SERVER_HOST = "127.0.0.1";
export const TMP_DIR = path.join(rootDir, "tmp");
export const OUTPUT_DIR = path.join(rootDir, "output");

