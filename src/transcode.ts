import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { DownloadOptions, ProgressEvent } from './types.js';
import type { ResolvedTools } from './binaries.js';
import { capture, spawnStreaming } from './exec.js';
import { makeFfmpegProgressParser } from './progress.js';

const DETACHED = process.platform !== 'win32';

export interface TranscodeHooks {
  onProgress?: (p: Omit<ProgressEvent, 'stage'>) => void;
  onLog?: (line: string) => void;
  /** Called with the ffmpeg child (and null when it exits) so the caller can cancel. */
  setChild?: (child: ChildProcess | null) => void;
}

async function probeCodecs(ffprobe: string, input: string): Promise<{ video: string | null; audio: string | null }> {
  const { stdout } = await capture(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', input]);
  let video: string | null = null;
  let audio: string | null = null;
  try {
    const data = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string }>;
    };
    for (const s of data.streams ?? []) {
      if (s.codec_type === 'video' && !video) video = s.codec_name ?? null;
      if (s.codec_type === 'audio' && !audio) audio = s.codec_name ?? null;
    }
  } catch {
    /* leave nulls; we'll just re-encode */
  }
  return { video, audio };
}

async function probeDuration(ffprobe: string, input: string): Promise<number | null> {
  try {
    const { stdout } = await capture(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input]);
    const n = parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Transcode (or losslessly remux) a media file to an editor-friendly mp4:
 *  H.264 video + AAC audio. Streams already H.264/AAC are copied; others are
 *  re-encoded. Deletes the partial output on failure. */
export async function transcodeToMp4(
  input: string,
  output: string,
  opts: DownloadOptions,
  tools: ResolvedTools,
  hooks: TranscodeHooks = {},
): Promise<void> {
  const { video, audio } = await probeCodecs(tools.ffprobe, input);
  const duration = await probeDuration(tools.ffprobe, input);

  const crf = opts.crf ?? 18;
  const preset = opts.preset ?? 'medium';
  const copyVideo = video === 'h264';
  const copyAudio = audio === 'aac';

  const args = ['-y', '-i', input, '-progress', 'pipe:1', '-nostats'];
  if (copyVideo) {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p');
  }
  if (audio) {
    args.push('-c:a', copyAudio ? 'copy' : 'aac');
    if (!copyAudio) args.push('-b:a', '192k');
  }
  args.push('-movflags', '+faststart', output);

  const onStdout = makeFfmpegProgressParser(duration, (p) => hooks.onProgress?.(p));
  const handle = spawnStreaming(tools.ffmpeg, args, onStdout, (line) => hooks.onLog?.(line), DETACHED);
  hooks.setChild?.(handle.child);

  try {
    await handle.done;
  } catch (err) {
    await fs.promises.rm(output, { force: true }).catch(() => {});
    throw err;
  } finally {
    hooks.setChild?.(null);
  }
}
