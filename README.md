# grapplehook-core

Framework-agnostic core for **grapplehook**. It orchestrates `yt-dlp`, `ffmpeg`,
and `aria2c` to fetch video info and download/transcode videos, exposing a clean
Node API with **structured progress events**, **cancellation**, and
**injectable binary paths** — so the same logic powers both the CLI and a desktop
(Electron) GUI.

Zero runtime dependencies. Ships ESM + CJS + types.

> The external tools (`yt-dlp`, `ffmpeg`/`ffprobe`, and optionally `aria2c`) are
> not bundled — they must be resolvable at runtime, either on `PATH` or via
> configured paths (handy for bundling with an app).

## Install

```bash
npm install grapplehook-core
```

## Usage

### Fetch info (for a quality picker / preview)

```ts
import { getVideoInfo } from "grapplehook-core";

const info = await getVideoInfo("https://youtu.be/<id>");
console.log(info.title, info.durationSeconds, info.thumbnail);
console.log(info.heights); // e.g. [2160, 1440, 1080, 720, ...] for a dropdown
```

### Download with progress + cancellation

```ts
import { download } from "grapplehook-core";

const task = download({
  url: "https://youtu.be/<id>",
  outputDir: "/path/to/output",
  quality: "1080p",   // "best" | "worst" | "2160p" | "1080p" | ...
  toMp4: true,        // transcode to editor-friendly H.264/AAC mp4
});

task.on("progress", (p) => {
  // p.stage: "info" | "download" | "transcode" | "done"
  // p.percent (0–100 | null), p.speed (bytes/s | null), p.eta (seconds | null)
  console.log(p.stage, p.percent, p.speed, p.eta);
});

// Cancel any time — kills subprocesses and removes partial files:
// task.cancel();

const { outputPath } = await task.done; // rejects with CancelledError if cancelled
```

### Check tool availability (e.g. a settings pane)

```ts
import { checkTools } from "grapplehook-core";

const status = await checkTools();
// { ytDlp: true, ffmpeg: true, ffprobe: true, aria2c: false }
```

### Point at bundled binaries (e.g. inside Electron)

Every entry point takes an optional config with explicit tool paths. Anything
omitted falls back to the env var (`YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`,
`ARIA2C_PATH`) and then to `PATH`.

```ts
const config = {
  tools: {
    ytDlp: "/app/resources/bin/yt-dlp",
    ffmpeg: "/app/resources/bin/ffmpeg",
    ffprobe: "/app/resources/bin/ffprobe",
    aria2c: "/app/resources/bin/aria2c",
  },
};

const info = await getVideoInfo(url, config);
const task = download(opts, config);
```

## API

- `getVideoInfo(url, config?) => Promise<VideoInfo>` — title, uploader, duration,
  thumbnail, `formats[]`, and distinct `heights[]`.
- `download(options, config?) => DownloadTask` — starts a job. The task is an
  `EventEmitter` (`progress`, `log`) plus:
  - `task.done: Promise<DownloadResult>` — resolves with `{ outputPath }`.
  - `task.cancel(): void` — stops it (tree-kills subprocesses, cleans temp files).
- `checkTools(config?) => Promise<{ ytDlp, ffmpeg, ffprobe, aria2c }>` — booleans.
- `resolveTools(paths?)`, `hasAria2c(path)` — lower-level helpers.
- `formatSelector(options)`, `buildDownloadArgs(...)`, `isTwoStage(options)` —
  exposed for testing/inspection.
- `CancelledError` — the rejection type when a task is cancelled.

### `DownloadOptions`

`url`, `outputDir` (required); `audioOnly`, `muxed`, `toMp4`, `crf` (default 18),
`preset` (default `medium`), `connections` (default 8), `aria2c` / `noAria2c`,
`quality` (default `best`), `filename`.

## How progress works

- **yt-dlp native downloader** — progress comes from a `--progress-template` line
  parsed into `{ percent, speed, eta, downloadedBytes, totalBytes }`.
- **aria2c** (used automatically when installed, unless `noAria2c`) — parsed from
  aria2c's console readout; slightly coarser but includes percent/speed/eta.
- **transcode** — parsed from ffmpeg's `-progress` output against the media
  duration, so you get a real transcode progress bar (and an ETA from the encode
  speed).

## Notes

- The pipeline downloads into a hidden temp dir inside `outputDir`, then moves
  (single stream) or transcodes (`--mp4`) to the final path — so `outputDir`
  never holds partial files, and a cancel leaves nothing behind.
- Cancellation tree-kills the process group on macOS/Linux and uses `taskkill /T`
  on Windows, so yt-dlp's child processes (aria2c/ffmpeg) are cleaned up too.

## Build

```bash
npm run build      # tsup -> dist (ESM + CJS + .d.ts)
npm run typecheck  # tsc --noEmit
```
