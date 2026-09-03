import { fork, type ChildProcess } from 'node:child_process';
import { chmod, lstat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
} from '../contracts/web-capture.mts';

export type AnchoredArtifactIdentity = Readonly<{ dev: number; ino: number }>;

export type AnchoredArtifactWriter = Readonly<{
  write(
    fileName: string,
    value: string | Buffer,
    signal: AbortSignal,
    onCreated: (identity: AnchoredArtifactIdentity) => void,
  ): Promise<void>;
  finish(cleanup: boolean): Promise<void>;
  terminate(): void;
}>;

type ChildRequest =
  | Readonly<{ type: 'write'; id: number; fileName: string; value: Buffer }>
  | Readonly<{ type: 'cancel'; id: number }>
  | Readonly<{ type: 'finish'; id: number; cleanup: boolean }>;

type ChildResponse =
  | Readonly<{ type: 'ready'; ok: true }>
  | Readonly<{ type: 'ready'; ok: false; message: string }>
  | Readonly<{ type: 'result'; id: number; ok: true; identity?: AnchoredArtifactIdentity }>
  | Readonly<{ type: 'result'; id: number; ok: false; message: string }>;

const FILE_LIMITS = new Map<string, number>([
  ['screenshot.png', MAX_WEB_CAPTURE_SCREENSHOT_BYTES],
  ['dom-digest.json', MAX_WEB_CAPTURE_DOM_DIGEST_BYTES],
  ['manifest.json', MAX_WEB_CAPTURE_MANIFEST_BYTES],
]);
const WRITER_OPERATION_TIMEOUT_MS = 5_000;

function sameIdentity(left: AnchoredArtifactIdentity, right: AnchoredArtifactIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function boundedChildMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Anchored artefact writer failed.';
  return message.replace(/[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300)
    || 'Anchored artefact writer failed.';
}

async function removeOwnedArtifacts(owned: ReadonlyMap<string, AnchoredArtifactIdentity>): Promise<void> {
  for (const [fileName, identity] of owned) {
    try {
      const current = await lstat(fileName);
      if (sameIdentity(current, identity)) await unlink(fileName);
    } catch {
      // An absent or replaced relative entry is not owned cleanup work.
    }
  }
}

async function runWriterChild(expected: AnchoredArtifactIdentity, expectedUid: number | null): Promise<void> {
  const current = await lstat('.');
  if (!current.isDirectory() || !sameIdentity(current, expected)) {
    throw new Error('Capture output directory identity changed before the anchored writer started.');
  }
  if (expectedUid !== null && current.uid !== expectedUid) {
    throw new Error('Capture output directory is not owned by the current user.');
  }
  await chmod('.', 0o700);
  const secured = await lstat('.');
  if (!secured.isDirectory() || !sameIdentity(secured, expected)
    || (process.platform !== 'win32' && (secured.mode & 0o077) !== 0)) {
    throw new Error('Capture output directory could not be secured without changing identity.');
  }

  const owned = new Map<string, AnchoredArtifactIdentity>();
  const controllers = new Map<number, AbortController>();
  const cancelled = new Set<number>();
  let keepArtifacts = false;
  let queue = Promise.resolve();
  const respond = (response: ChildResponse) => new Promise<void>((resolve) => {
    if (!process.send) {
      resolve();
      return;
    }
    process.send(response, (error) => {
      if (error) process.exitCode = 1;
      resolve();
    });
  });
  const handle = async (message: Exclude<ChildRequest, { type: 'cancel' }>) => {
    if (message.type === 'write') {
      const maximumBytes = FILE_LIMITS.get(message.fileName);
      if (!maximumBytes || !(message.value instanceof Uint8Array) || message.value.byteLength < 1 || message.value.byteLength > maximumBytes) {
        throw new Error('Capture artefact write request is malformed or outside its byte bound.');
      }
      if (owned.has(message.fileName)) throw new Error('Capture artefact file name was already written.');
      const controller = new AbortController();
      controllers.set(message.id, controller);
      try {
        if (cancelled.delete(message.id)) {
          throw new Error('Capture artefact write was cancelled.');
        }
        const file = await open(message.fileName, 'wx', 0o600);
        let created: AnchoredArtifactIdentity;
        try {
          const identity = await file.stat();
          if (!identity.isFile()) throw new Error('Capture artefact destination is not a regular file.');
          created = { dev: identity.dev, ino: identity.ino };
          owned.set(message.fileName, created);
          await file.writeFile(message.value, { signal: controller.signal });
        } finally {
          await file.close();
        }
        await respond({ type: 'result', id: message.id, ok: true, identity: created });
      } finally {
        controllers.delete(message.id);
        cancelled.delete(message.id);
      }
      return;
    }
    if (message.cleanup) await removeOwnedArtifacts(owned);
    else keepArtifacts = true;
    await respond({ type: 'result', id: message.id, ok: true });
    process.disconnect();
  };

  process.on('message', (message: ChildRequest) => {
    if (message?.type === 'cancel') {
      const controller = controllers.get(message.id);
      if (controller) controller.abort(new Error('Capture artefact write was cancelled.'));
      else if (Number.isSafeInteger(message.id) && message.id > 0 && cancelled.size < 64) {
        cancelled.add(message.id);
      }
      return;
    }
    queue = queue.then(() => handle(message)).catch(async (error) => {
      await respond({ type: 'result', id: message?.id ?? -1, ok: false, message: boundedChildMessage(error) });
    });
  });
  process.on('disconnect', () => {
    void queue.then(async () => {
      if (!keepArtifacts) await removeOwnedArtifacts(owned);
      process.exit();
    });
  });
  await respond({ type: 'ready', ok: true });
}

function operationDeadline<T>(operation: Promise<T>, child: ChildProcess): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Anchored capture artefact writer timed out.'));
    }, WRITER_OPERATION_TIMEOUT_MS);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function startAnchoredArtifactWriter(
  directory: string,
  expected: AnchoredArtifactIdentity,
  expectedUid: number | null,
): Promise<AnchoredArtifactWriter> {
  const child = fork(fileURLToPath(import.meta.url), [
    '--writer-child',
    String(expected.dev),
    String(expected.ino),
    expectedUid === null ? 'none' : String(expectedUid),
  ], {
    cwd: directory,
    execArgv: [],
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let nextId = 1;
  let readySettled = false;
  let finished = false;
  const pending = new Map<number, {
    resolve(response: Extract<ChildResponse, { type: 'result'; ok: true }>): void;
    reject(error: Error): void;
  }>();
  const ready = new Promise<void>((resolve, reject) => {
    child.on('message', (message: ChildResponse) => {
      if (message?.type === 'ready') {
        readySettled = true;
        if (message.ok) resolve();
        else reject(new Error(message.message));
        return;
      }
      if (message?.type !== 'result') return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message);
      else request.reject(new Error(message.message));
    });
    child.once('error', (error) => {
      if (!readySettled) reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    });
    child.once('exit', (code, signal) => {
      const error = new Error(`Anchored capture artefact writer exited before completion (${signal ?? code ?? 'unknown'}).`);
      if (!readySettled) reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    });
  });
  await operationDeadline(ready, child).catch((error) => {
    child.kill();
    throw error;
  });

  const request = (message:
    | Readonly<{ type: 'write'; fileName: string; value: Buffer }>
    | Readonly<{ type: 'finish'; cleanup: boolean }>) => {
    if (finished) return Promise.reject(new Error('Anchored capture artefact writer is already closed.'));
    const id = nextId++;
    const result = new Promise<Extract<ChildResponse, { type: 'result'; ok: true }>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        child.send({ ...message, id } as ChildRequest, (error) => {
          if (!error) return;
          pending.delete(id);
          reject(error);
        });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error('Anchored capture artefact writer IPC failed.'));
      }
    });
    return operationDeadline(result, child);
  };

  return Object.freeze({
    async write(fileName, value, signal, onCreated) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const id = nextId;
      const cancel = () => {
        if (!child.connected) return;
        try {
          child.send({ type: 'cancel', id } satisfies ChildRequest, (error) => {
            if (error) child.kill();
          });
        } catch {
          child.kill();
        }
      };
      if (signal.aborted) throw signal.reason;
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const response = await request({ type: 'write', fileName, value: buffer });
        if (!response.identity) throw new Error('Anchored capture artefact writer omitted the created-file identity.');
        onCreated(response.identity);
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    async finish(cleanup) {
      const response = await request({ type: 'finish', cleanup });
      finished = true;
      if (response.identity) throw new Error('Anchored capture artefact writer returned an unexpected file identity.');
    },
    terminate() {
      finished = true;
      child.kill();
    },
  });
}

const invokedAsScript = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript && process.argv[2] === '--writer-child') {
  const dev = Number(process.argv[3]);
  const ino = Number(process.argv[4]);
  const uid = process.argv[5] === 'none' ? null : Number(process.argv[5]);
  try {
    if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino)
      || (uid !== null && !Number.isSafeInteger(uid))) {
      throw new Error('Anchored artefact writer identity arguments are malformed.');
    }
    await runWriterChild({ dev, ino }, uid);
  } catch (error) {
    if (process.send) {
      process.send(
        { type: 'ready', ok: false, message: boundedChildMessage(error) } satisfies ChildResponse,
        () => process.disconnect(),
      );
    } else process.stderr.write(`${boundedChildMessage(error)}\n`);
    process.exitCode = 1;
  }
}
