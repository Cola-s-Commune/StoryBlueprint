import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isAllowedUpdateUrl } from './updateChecker';

export interface UpdateArtifactDownload {
  url: string;
  sha512: string;
  size: number;
  directory: string;
}

export interface UpdateDownloadProgress {
  received: number;
  total: number;
}

function artifactFileName(url: string): string {
  const fileName = basename(new URL(url).pathname);
  if (!/^[A-Za-z0-9._-]+\.exe$/i.test(fileName)) {
    throw new Error('Update artifact URL must name a Windows executable');
  }
  return fileName;
}

function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: Uint8Array): Promise<void> {
  if (stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

function finishStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

export async function downloadVerifiedUpdateArtifact(
  artifact: UpdateArtifactDownload,
  onProgress: (progress: UpdateDownloadProgress) => void,
  signal: AbortSignal,
  fetchArtifact: typeof fetch = fetch,
): Promise<string> {
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new Error('Update artifact has an invalid size');
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512)) {
    throw new Error('Update artifact has an invalid SHA-512 hash');
  }
  const response = await fetchArtifact(artifact.url, { signal });
  if (!response.ok || !response.body) throw new Error(`Update download returned HTTP ${response.status}`);
  if (!response.url || !isAllowedUpdateUrl(response.url)) {
    throw new Error('Update download redirected to an unsafe URL');
  }
  const advertisedSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedSize) && advertisedSize !== artifact.size) {
    throw new Error('Update download size does not match its signed manifest');
  }

  const fileName = artifactFileName(artifact.url);
  await mkdir(artifact.directory, { recursive: true });
  const destination = join(artifact.directory, fileName);
  const temporary = join(artifact.directory, `.${fileName}.${randomUUID()}.part`);
  const output = createWriteStream(temporary, { flags: 'wx' });
  const hash = createHash('sha512');
  let received = 0;
  try {
    const reader = response.body.getReader();
    let completed = false;
    while (!completed) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        continue;
      }
      const chunk = next.value;
      received += chunk.byteLength;
      if (received > artifact.size) throw new Error('Update download exceeds its signed size');
      hash.update(chunk);
      await writeChunk(output, chunk);
      onProgress({ received, total: artifact.size });
    }
    await finishStream(output);
    if (received !== artifact.size) throw new Error('Update download size does not match its signed manifest');
    if (hash.digest('base64') !== artifact.sha512) {
      throw new Error('Update download hash does not match its signed manifest');
    }
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    output.destroy();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
