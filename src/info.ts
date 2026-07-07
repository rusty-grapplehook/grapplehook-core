import type { CoreConfig, VideoFormat, VideoInfo } from "./types.js";
import { resolveTools } from "./binaries.js";
import { capture } from "./exec.js";

interface RawFormat {
  format_id?: string;
  ext?: string;
  resolution?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  format_note?: string;
}

interface RawInfo {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  formats?: RawFormat[];
}

/** Fetch title, thumbnail, duration and available formats for a video URL. */
export async function getVideoInfo(url: string, config: CoreConfig = {}): Promise<VideoInfo> {
  const tools = resolveTools(config.tools);
  const { stdout } = await capture(tools.ytDlp, ["--no-playlist", "-J", url]);
  const raw = JSON.parse(stdout) as RawInfo;

  const formats: VideoFormat[] = (raw.formats ?? []).map((f) => ({
    formatId: f.format_id ?? "",
    ext: f.ext ?? "",
    resolution:
      f.resolution ?? (f.width && f.height ? `${f.width}x${f.height}` : null),
    height: f.height ?? null,
    fps: f.fps ?? null,
    vcodec: f.vcodec ?? null,
    acodec: f.acodec ?? null,
    filesize: f.filesize ?? f.filesize_approx ?? null,
    tbr: f.tbr ?? null,
    note: f.format_note ?? null,
  }));

  const heights = Array.from(
    new Set(
      formats
        .filter((f) => f.vcodec && f.vcodec !== "none" && f.height != null)
        .map((f) => f.height as number)
    )
  ).sort((a, b) => b - a);

  return {
    id: raw.id ?? "",
    title: raw.title ?? "",
    uploader: raw.uploader ?? raw.channel ?? null,
    durationSeconds: raw.duration ?? null,
    thumbnail: raw.thumbnail ?? null,
    formats,
    heights,
  };
}