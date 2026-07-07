import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { buildDownloadArgs, isTwoStage } from './args.js';
import { hasAria2c, resolveTools, type ResolvedTools } from './binaries.js';
import { killTree, spawnStreaming } from './exec.js';
import { parseAria2cProgress, parseYtDlpProgress } from './progress.js';
import { transcodeToMp4 } from './transcode.js';
import type { CoreConfig, DownloadOptions, DownloadResult, DownloadStage, ProgressEvent } from './types.js';

const DETACHED = process.platform !== 'win32';
const MEDIA_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.m4a', '.opus', '.ogg', '.aac', '.mp3'];

export class CancelledError extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'CancelledError';
  }
}

export interface DownloadTaskEvents {
  progress: (p: ProgressEvent) => void;
  log: (line: string) => void;
}

// Typed EventEmitter surface via declaration merging.
export interface IDownloadTask {
  on<E extends keyof DownloadTaskEvents>(event: E, listener: DownloadTaskEvents[E]): this;
  once<E extends keyof DownloadTaskEvents>(event: E, listener: DownloadTaskEvents[E]): this;
  off<E extends keyof DownloadTaskEvents>(event: E, listener: DownloadTaskEvents[E]): this;
  emit<E extends keyof DownloadTaskEvents>(event: E, ...args: Parameters<DownloadTaskEvents[E]>): boolean;
}

/**
 * A single download job. Listen for `progress` / `log` events, await `done`
 * for the result, and call `cancel()` to stop it (kills subprocesses and
 * cleans up partial files).
 */
export class DownloadTask extends EventEmitter {
  /** Resolves with the output path, or rejects (CancelledError on cancel). */
  readonly done: Promise<DownloadResult>;

  private child: ChildProcess | null = null;
  private cancelled = false;
  private tmpDir: string | null = null;

  constructor(
    private readonly opts: DownloadOptions,
    private readonly config: CoreConfig = {},
  ) {
    super();
    // Start on the next microtask so callers can attach `progress`/`log`
    // listeners synchronously after download() before any event fires.
    this.done = Promise.resolve().then(() => this.run());
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }

    this.cancelled = true;

    if (this.child) {
      killTree(this.child);
    }
  }

  private setChild = (c: ChildProcess | null): void => {
    this.child = c;
  };

  private emitProgress(stage: DownloadStage, p: Omit<ProgressEvent, 'stage'>): void {
    this.emit('progress', { stage, ...p });
  }

  private handleDownloadLine = (line: string): void => {
    this.emit('log', line);

    const p = parseYtDlpProgress(line) ?? parseAria2cProgress(line);

    if (p) {
      this.emitProgress('download', p);
    }
  };

  private async runDownload(tools: ResolvedTools, args: string[]): Promise<void> {
    if (this.cancelled) {
      throw new CancelledError();
    }

    const handle = spawnStreaming(tools.ytDlp, args, this.handleDownloadLine, this.handleDownloadLine, DETACHED);

    this.setChild(handle.child);

    try {
      await handle.done;
    } finally {
      this.setChild(null);
    }
  }

  private async run(): Promise<DownloadResult> {
    const tools = resolveTools(this.config.tools);

    try {
      this.emitProgress('info', { percent: null, speed: null, eta: null });

      const useAria2c = await this.resolveDownloader(tools);

      fs.mkdirSync(this.opts.outputDir, { recursive: true });
      this.tmpDir = fs.mkdtempSync(path.join(this.opts.outputDir, '.grapplehook-'));

      await this.runDownload(tools, buildDownloadArgs(this.opts, tools, useAria2c, this.tmpDir));

      if (this.cancelled) {
        throw new CancelledError();
      }

      const input = this.findDownloaded(this.tmpDir);
      const base = this.opts.filename ?? path.basename(input, path.extname(input));

      let outputPath: string;

      if (isTwoStage(this.opts)) {
        outputPath = path.join(this.opts.outputDir, `${base}.mp4`);
        await transcodeToMp4(input, outputPath, this.opts, tools, {
          onProgress: (p) => {
            if (!this.cancelled) {
              this.emitProgress('transcode', p);
            }
          },
          onLog: (line) => this.emit('log', line),
          setChild: this.setChild,
        });
      } else {
        outputPath = path.join(this.opts.outputDir, path.basename(input));
        fs.rmSync(outputPath, { force: true });
        fs.renameSync(input, outputPath);
      }

      if (this.cancelled) {
        throw new CancelledError();
      }

      this.emitProgress('done', { percent: 100, speed: null, eta: null });

      return { outputPath };
    } catch (err) {
      if (this.cancelled) {
        throw new CancelledError();
      }

      throw err;
    } finally {
      this.cleanupTemp();
    }
  }

  private async resolveDownloader(tools: ResolvedTools): Promise<boolean> {
    if (this.opts.noAria2c) {
      return false;
    }

    if (this.opts.aria2c) {
      return true;
    }

    return hasAria2c(tools.aria2c);
  }

  private findDownloaded(dir: string): string {
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));

    if (files.length === 0) {
      throw new Error('yt-dlp produced no output file.');
    }

    const media = files.find((f) => MEDIA_EXTS.includes(path.extname(f).toLowerCase()));

    return path.join(dir, media ?? files[0]);
  }

  private cleanupTemp(): void {
    if (this.tmpDir) {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
      this.tmpDir = null;
    }
  }
}

/** Start a download. Returns a DownloadTask (events + `done` promise + `cancel()`). */
export function download(options: DownloadOptions, config?: CoreConfig): IDownloadTask {
  return new DownloadTask(options, config);
}
