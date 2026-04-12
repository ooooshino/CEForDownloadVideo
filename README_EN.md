# Chrome Video Export Extension

This project has two parts:

- `extension/`: the Chrome extension. It detects videos on supported sites, shows them in the side panel, and sends export jobs to the local server.
- `local-server/`: the local server. It downloads source videos, adds the uploaded image as a short intro, trims the clip, and writes the final file to disk.

This repository is no longer just the initial MVP. It already includes site-specific detection logic, updated export rules, a redesigned side panel, and a Windows packaging workflow.

Chinese documentation: [README.md](./README.md)

## Currently supported sites

- `https://www.xfree.com/*`
- `https://fyptt.to/*`
- `https://www.redgifs.com/*`

Notes:

- `xfree` uses the generic detection flow.
- `fyptt` uses a detail-page-specific parser.
- `redgifs` uses its own dedicated explore/detail flow and is kept separate from the other sites.

## Project structure

```text
downloadVideo/
├── .github/
│   └── workflows/
│       └── build-local-server-win.yml
├── README.md
├── README_EN.md
├── extension/
│   ├── build.mjs
│   ├── manifest.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   └── dist/
└── local-server/
    ├── build-executable.mjs
    ├── build-win.mjs
    ├── package.json
    ├── tsconfig.json
    ├── src/
    ├── dist/
    └── bin/
```

## Requirements

### For development

- macOS
- Node.js 20+
- Google Chrome
- `ffmpeg` and `ffprobe` installed on the system

### For Windows distribution

- End users do not need Node
- A GitHub Actions workflow can build a Windows package
- The Windows package includes `ffmpeg.exe` and `ffprobe.exe`

## Install ffmpeg

If ffmpeg is not installed on your Mac:

```bash
brew install ffmpeg
```

Check the installation:

```bash
ffmpeg -version
ffprobe -version
```

## Install dependencies

```bash
cd extension && npm install
cd ../local-server && npm install
```

## Build the extension

```bash
cd extension
npm run build
```

Load this folder in Chrome:

```text
extension/dist
```

## Start the local server

Development mode:

```bash
cd local-server
npm run dev
```

Production mode:

```bash
cd local-server
npm run build
npm start
```

Default server URL:

```text
http://127.0.0.1:37891
```

Optional batch concurrency config:

```bash
VIDEO_EXPORT_BATCH_CONCURRENCY=5 npm start
```

Notes:

- Default is `5`
- If the env var is not provided, the default is used
- You can tune it by machine capacity, e.g. `3`, `5`, or `8`

Health check:

```bash
curl http://127.0.0.1:37891/health
```

## Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click “Load unpacked”
4. Select `extension/dist`
5. Pin the extension
6. Click the extension icon to open the side panel

## How to use it

1. Start the local server
2. Open a supported website
3. Open the side panel
4. Wait for video detection, or click refresh if needed
5. Select the videos you want
6. Upload one image
7. Enter a start and end time, such as `0` and `8`
8. Click export
9. Wait for the results to appear in the result section

## Multi-cover frozen batch flow (new)

For multi-cover planning and overlap-based export, use the frozen flow:

1. Select videos in side panel and click `锁定已选`
2. You will enter the standalone `selection` page
3. Upload multiple covers
4. Use auto distribution or manually edit each cover `from/to`
5. Overlaps are supported (one video can map to multiple covers)
6. Set start/end time and run batch export
7. Check per-task results (success/failure/output path)

Behavior:

- Side panel refresh does not clear frozen data
- Data is reset only by manual clear or re-freeze
- Same source video with different covers produces separate outputs

Output directory:

```text
~/Downloads/cutVideo/
```

## Current export rules

- Export uses a start time and an end time instead of a fixed total duration
- The uploaded image is inserted as a very short opening frame
- Portrait source videos stay portrait
- Landscape source videos are cropped into portrait before export
- Final output is always a portrait MP4

### Trim validation

- If start time is within the video and end time is within the video, the clip is exported normally
- If end time is longer than the video, it is clamped to the video end
- If end time is less than or equal to start time, the UI shows an error
- If start time is greater than or equal to the video duration, the UI shows an error

## Current side panel behavior

- Uses a side panel instead of a popup
- Uses portrait video cards
- Hover to preview
- Only one video keeps playing at a time
- Top area stays fixed while scrolling
- Auto refresh runs every 5 seconds
- The UI has already been redesigned into the newer dark look

## Local server API

### `GET /health`

Returns server and ffmpeg status:

```json
{
  "ok": true,
  "ffmpeg": true,
  "ffprobe": true
}
```

### `POST /export`

Form fields:

- `cover`: image file
- `startTime`: trim start
- `endTime`: trim end
- `pageUrl`: current page URL
- `videos`: JSON string array

Example:

```bash
curl -X POST http://127.0.0.1:37891/export \
  -F "cover=@/path/to/cover.jpg" \
  -F "startTime=0" \
  -F "endTime=8" \
  -F "pageUrl=https://www.redgifs.com/watch/demo" \
  -F 'videos=["https://example.com/video.mp4"]'
```

### `POST /export/batch`

Used by the multi-cover batch workflow. Form fields:

- `startTime`: trim start
- `endTime`: trim end
- `pageUrl`: current page URL
- `cover-{n}`: multiple uploaded cover files (e.g. `cover-1`, `cover-2`)
- `tasks`: JSON string array. Each task includes:
  - `taskId`
  - `videoIndex`
  - `videoSrc`
  - `coverIndex`
  - `coverUploadField` (e.g. `cover-1`)

Server behavior:

- Worker-pool execution, default concurrency `5`
- One task failure does not abort the whole batch
- Output filenames include `video-{n}` and `cover-{n}` to avoid collisions

## Windows packaging

The repo already includes a GitHub Actions workflow:

- `Build Windows Local Server`

What it does:

- installs dependencies
- installs `ffmpeg`
- builds the Windows local server package
- bundles `ffmpeg.exe` and `ffprobe.exe`
- verifies `/health`
- uploads a zip artifact

How to get the Windows package:

1. Open the repository `Actions` tab
2. Run `Build Windows Local Server`
3. Wait for it to finish
4. Download the `VideoExportLocalServer-win-x64` artifact from the run page

## Why the project is split this way

### Why detection runs in the content script

Because it is closest to the real page and can read actual browser-resolved video data.

### Why there is a service worker

Because the side panel cannot directly read page DOM, so it needs a tab-scoped middle layer.

### Why heavy work runs in the local server

Because browser-side heavy video processing is slower and less stable than using system ffmpeg.

### Why detection is not done with a single generic method

Different sites expose videos in very different ways:

- directly in DOM
- inserted later
- visible only in browser resource records
- completely different between list pages and detail pages

That is why the project now uses site-specific logic instead of forcing one universal flow.

## Known limitations

- Only `mp4` is officially exportable right now
- `m3u8`, `blob`, and `dash` may appear in the list, but are not exported yet
- `xxxtik` looks technically possible to support, but is not part of the supported site list yet

## FAQ

### The side panel says it cannot connect

- Make sure the local server is running
- Make sure the port is still `37891`
- Open `http://127.0.0.1:37891/health` to confirm it responds

### Health check says ffmpeg is missing

- Make sure `ffmpeg` and `ffprobe` are installed
- If you just installed them, restart the terminal and start the server again

### Why are some detected items not exportable

- Because only `mp4` is fully supported right now
- Other resource types are kept visible for future extension work

### Why can one video fail while the batch still continues

- Because the server processes each video independently
- One failure does not abort the whole batch

### Why did Redgifs stop around one hundred items before

- There used to be a hard limit in code
- That limit has now been removed
