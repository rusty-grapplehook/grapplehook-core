import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface CaptureResult {
  stdout: string;
  stderr: string;
}

export function toToolError(cmd: string, err: NodeJS.ErrnoException): Error {
  if (err.code === 'ENOENT') {
    return new Error(`Could not find "${cmd}". Make sure it is installed and on your PATH, ` + 'or configure its path.');
  }

  return err;
}

/** Run a command to completion, capturing stdout/stderr. Rejects on failure. */
export function capture(cmd: string, args: string[]): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d) => (stdout += d));
    proc.stderr?.on('data', (d) => (stderr += d));
    proc.on('error', (err: NodeJS.ErrnoException) => reject(toToolError(cmd, err)));
    proc.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} exited with code ${code}` + (stderr ? `: ${stderr.trim().slice(0, 400)}` : ''))),
    );
  });
}

export interface SpawnStreamingHandle {
  child: ChildProcess;
  done: Promise<void>;
}

/** Spawn a command and deliver stdout/stderr to callbacks line by line
 *  (splitting on \n and \r so progress readouts are captured). */
export function spawnStreaming(
  cmd: string,
  args: string[],
  onStdoutLine?: (line: string) => void,
  onStderrLine?: (line: string) => void,
  detached = false,
): SpawnStreamingHandle {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached });

  readLines(child.stdout, onStdoutLine);
  readLines(child.stderr, onStderrLine);

  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) => reject(toToolError(cmd, err)));
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else if (signal) {
        reject(new Error(`${cmd} terminated by signal ${signal}`));
      } else {
        reject(new Error(`${cmd} exited with code ${code ?? 'null'}`));
      }
    });
  });

  return { child, done };
}

function readLines(stream: Readable | null, onLine?: (line: string) => void): void {
  if (!stream || !onLine) {
    return;
  }

  stream.setEncoding('utf8');

  let buf = '';

  stream.on('data', (chunk: string) => {
    buf += chunk;

    const parts = buf.split(/\r\n|\r|\n/);

    buf = parts.pop() ?? '';

    for (const line of parts) {
      if (line.length) {
        onLine(line);
      }
    }
  });
  stream.on('end', () => {
    if (buf.length) {
      onLine(buf);
    }
  });
}

/** Terminate a child and its descendants (yt-dlp may have spawned aria2c/ffmpeg).
 *  Group-kill requires the child to have been spawned with detached: true. */
export function killTree(child: ChildProcess): void {
  if (child.pid == null) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } catch {
      child.kill();
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already exited */
      }
    }
  }
}
