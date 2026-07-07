import type { CoreConfig, ToolPaths } from './types.js';
import { capture } from './exec.js';

export interface ResolvedTools {
  ytDlp: string;
  ffmpeg: string;
  ffprobe: string;
  aria2c: string;
}

function pick(override: string | undefined, envVal: string | undefined, fallback: string): string {
  if (override && override.trim()) return override.trim();
  if (envVal && envVal.trim()) return envVal.trim();
  return fallback;
}

/** Resolve tool binaries from explicit paths, then env vars, then PATH. */
export function resolveTools(paths: ToolPaths = {}): ResolvedTools {
  return {
    ytDlp: pick(paths.ytDlp, process.env.YTDLP_PATH, 'yt-dlp'),
    ffmpeg: pick(paths.ffmpeg, process.env.FFMPEG_PATH, 'ffmpeg'),
    ffprobe: pick(paths.ffprobe, process.env.FFPROBE_PATH, 'ffprobe'),
    aria2c: pick(paths.aria2c, process.env.ARIA2C_PATH, 'aria2c'),
  };
}

async function canRun(bin: string, versionFlag = '--version'): Promise<boolean> {
  try {
    await capture(bin, [versionFlag]);
    return true;
  } catch {
    return false;
  }
}

export async function hasAria2c(aria2c: string): Promise<boolean> {
  return canRun(aria2c);
}

export interface ToolAvailability {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  aria2c: boolean;
}

/** Check which tools are runnable — useful for a GUI settings/status pane. */
export async function checkTools(config: CoreConfig = {}): Promise<ToolAvailability> {
  const t = resolveTools(config.tools);
  const [ytDlp, ffmpeg, ffprobe, aria2c] = await Promise.all([
    canRun(t.ytDlp),
    canRun(t.ffmpeg, '-version'),
    canRun(t.ffprobe, '-version'),
    canRun(t.aria2c),
  ]);
  return { ytDlp, ffmpeg, ffprobe, aria2c };
}
