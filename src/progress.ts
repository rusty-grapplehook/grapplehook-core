import type { ProgressEvent } from './types.js';

type PartialProgress = Omit<ProgressEvent, 'stage'>;

function num(v: string | undefined): number | null {
  if (v == null || v === 'NA' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function unitFactor(u: string): number {
  const s = u.toUpperCase();
  if (s.startsWith('K')) return 1024;
  if (s.startsWith('M')) return 1024 ** 2;
  if (s.startsWith('G')) return 1024 ** 3;
  if (s.startsWith('T')) return 1024 ** 4;
  return 1;
}

function parseSize(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*([A-Za-z]*)$/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return Number.isFinite(val) ? Math.round(val * unitFactor(m[2])) : null;
}

function parseAria2Time(s: string | undefined): number | null {
  if (!s) return null;
  let total = 0;
  let matched = false;
  const re = /(\d+)(h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : n;
  }
  return matched ? total : null;
}

/** Parse a line emitted by our yt-dlp --progress-template (native downloader). */
export function parseYtDlpProgress(line: string): PartialProgress | null {
  if (!line.startsWith('GHPROGRESS ')) return null;
  const p = line.split(' ');
  const downloadedBytes = num(p[1]);
  const totalBytes = num(p[2]) ?? num(p[3]); // total_bytes ?? total_bytes_estimate
  const speed = num(p[4]);
  const eta = num(p[5]);
  const percent = downloadedBytes != null && totalBytes && totalBytes > 0 ? clampPct((downloadedBytes / totalBytes) * 100) : null;
  return { percent, speed, eta, downloadedBytes, totalBytes };
}

/** Parse an aria2c console readout, e.g.
 *  [#a1b2c3 12MiB/345MiB(3%) CN:8 DL:5.2MiB ETA:1m2s] */
export function parseAria2cProgress(line: string): PartialProgress | null {
  const pctM = line.match(/\((\d+)%\)/);
  if (!pctM) return null;
  const sizeM = line.match(/([\d.]+[A-Za-z]*)\/([\d.]+[A-Za-z]*)\(\d+%\)/);
  const dlM = line.match(/DL:([\d.]+[A-Za-z]*)/);
  const etaM = line.match(/ETA:([0-9hms]+)/);
  return {
    percent: clampPct(Number(pctM[1])),
    speed: dlM ? parseSize(dlM[1]) : null,
    eta: etaM ? parseAria2Time(etaM[1]) : null,
    downloadedBytes: sizeM ? parseSize(sizeM[1]) : null,
    totalBytes: sizeM ? parseSize(sizeM[2]) : null,
  };
}

/** Build a stateful line handler for ffmpeg's `-progress pipe:1` output.
 *  Accumulates key=value lines and emits on each `progress=` marker. */
export function makeFfmpegProgressParser(durationSec: number | null, emit: (p: PartialProgress) => void): (line: string) => void {
  let outTimeUs: number | null = null;
  let speedX: number | null = null;

  return (line: string) => {
    const eq = line.indexOf('=');
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();

    if (key === 'out_time_us' || key === 'out_time_ms') {
      // Both fields are microseconds in ffmpeg's -progress output.
      const n = Number(val);
      if (Number.isFinite(n)) outTimeUs = n;
    } else if (key === 'speed') {
      const m = val.match(/([\d.]+)x/);
      speedX = m ? Number(m[1]) : null;
    } else if (key === 'progress') {
      const outSec = outTimeUs != null ? outTimeUs / 1e6 : null;
      const percent = durationSec && outSec != null ? clampPct((outSec / durationSec) * 100) : null;
      const eta = durationSec && outSec != null && speedX && speedX > 0 ? Math.max(0, (durationSec - outSec) / speedX) : null;
      emit({ percent, speed: null, eta, downloadedBytes: null, totalBytes: null });
    }
  };
}
