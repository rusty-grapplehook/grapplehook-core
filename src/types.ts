/** Overrides for the external tool binaries. Any omitted value falls back to
 *  the matching env var (YTDLP_PATH / FFMPEG_PATH / FFPROBE_PATH / ARIA2C_PATH)
 *  and then to the plain command name on PATH. Lets a GUI point at bundled
 *  binaries. */
export interface ToolPaths {
  ytDlp?: string;
  ffmpeg?: string;
  ffprobe?: string;
  aria2c?: string;
}

export interface CoreConfig {
  tools?: ToolPaths;
}

/** "best" | "worst" | a max height like "1080p" / "2160" */
export type Quality = string;

export interface DownloadOptions {
  url: string;
  /** Directory the final file is written to. */
  outputDir: string;
  /** Download audio only (native format). */
  audioOnly?: boolean;
  /** Grab a single combined stream instead of merging (fast, lower res). */
  muxed?: boolean;
  /** Transcode the result to editor-friendly H.264/AAC mp4. */
  toMp4?: boolean;
  /** libx264 quality for the transcode (0–51, lower = better). Default 18. */
  crf?: number;
  /** libx264 preset for the transcode. Default "medium". */
  preset?: string;
  /** Parallel connections for aria2c / -N. Default 8. */
  connections?: number;
  /** Force aria2c as the downloader (otherwise auto-used when available). */
  aria2c?: boolean;
  /** Force yt-dlp's native downloader even when aria2c is available. */
  noAria2c?: boolean;
  /** "best" | "worst" | a max height like "1080p". Default "best". */
  quality?: Quality;
  /** Output filename without extension. Defaults to the video title. */
  filename?: string;
}

export type DownloadStage = 'info' | 'download' | 'transcode' | 'done';

export interface ProgressEvent {
  stage: DownloadStage;
  /** 0–100, or null when unknown. */
  percent: number | null;
  /** Bytes per second, or null. */
  speed: number | null;
  /** Seconds remaining, or null. */
  eta: number | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
}

export interface DownloadResult {
  /** Absolute path of the finished file. */
  outputPath: string;
}

export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string | null;
  height: number | null;
  fps: number | null;
  /** Codec name, or "none" for audio-only formats. */
  vcodec: string | null;
  /** Codec name, or "none" for video-only formats. */
  acodec: string | null;
  filesize: number | null;
  /** Total bitrate (kbps). */
  tbr: number | null;
  note: string | null;
}

export interface VideoInfo {
  id: string;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  formats: VideoFormat[];
  /** Distinct video heights available, descending - handy for a quality picker. */
  heights: number[];
}
