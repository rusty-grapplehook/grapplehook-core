import type { DownloadOptions } from './types.js';
import type { ResolvedTools } from './binaries.js';

/** Does this run use the two-stage download -> transcode pipeline? */
export function isTwoStage(opts: DownloadOptions): boolean {
  return !!opts.toMp4 && !opts.audioOnly && !opts.muxed;
}

/** Translate options into a yt-dlp -f format selector. */
export function formatSelector(opts: DownloadOptions): string {
  const q = (opts.quality ?? 'best').toLowerCase();
  const m = q.match(/^(\d{3,4})p?$/);
  const height = m ? Number(m[1]) : null;
  const worst = q === 'worst' || q === 'lowest';

  if (opts.audioOnly) return worst ? 'worstaudio/worst' : 'bestaudio/best';
  if (opts.muxed) return worst ? 'worst' : height ? `b[height<=${height}]/b` : 'b';
  if (worst) return 'wv*+wa/w';
  return height ? `bv*[height<=${height}]+ba/b[height<=${height}]` : 'bv*+ba/b';
}

/** Build the yt-dlp argument list. Emits machine-readable progress via
 *  --progress-template so it can be parsed into ProgressEvents. */
export function buildDownloadArgs(opts: DownloadOptions, tools: ResolvedTools, useAria2c: boolean, destDir: string): string[] {
  const filenameTemplate = opts.filename ? `${opts.filename}.%(ext)s` : '%(title)s.%(ext)s';

  const args = [
    '--no-playlist',
    '--newline',
    '--progress-template',
    'download:GHPROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s ' +
      '%(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    '-P',
    destDir,
    '-o',
    filenameTemplate,
    '-f',
    formatSelector(opts),
  ];

  const connections = opts.connections ?? 8;
  if (useAria2c) {
    const x = Math.min(Math.max(1, connections), 16); // aria2c caps at 16/server
    args.push('--downloader', tools.aria2c, '--downloader-args', `aria2c:-x ${x} -s ${x} -k 1M --summary-interval=1`);
  } else if (connections > 1) {
    args.push('-N', String(connections));
  }

  args.push(opts.url);
  return args;
}
