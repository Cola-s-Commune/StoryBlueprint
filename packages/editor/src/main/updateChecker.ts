import { createPublicKey, verify } from 'node:crypto';
import type { UpdateCheckResult, UpdateManifest, UpdateSettings } from '../shared/electronApi';
import trustedUpdateKeys from '../../update-public-keys.json';

const MAX_UPDATE_MANIFEST_BYTES = 1 * 1024 * 1024;
const TRUSTED_UPDATE_KEYS: Readonly<Record<string, string>> = trustedUpdateKeys;

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (number | string)[];
}

declare const __OFFICIAL_FEED_URL__: string | undefined;

export const DEFAULT_OFFICIAL_FEED_URL =
  typeof __OFFICIAL_FEED_URL__ !== 'undefined'
    ? __OFFICIAL_FEED_URL__
    : 'https://storyblueprint.biaozi.biz:8443/updates';

export const defaultUpdateSettings: UpdateSettings = {
  enabled: true,
  feedUrl: DEFAULT_OFFICIAL_FEED_URL,
  channel: 'stable',
  autoCheck: true,
};

export function isAllowedUpdateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    );
  } catch {
    return false;
  }
}

export function isUpdateSettings(value: unknown): value is UpdateSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Partial<UpdateSettings>;
  return (
    typeof settings.enabled === 'boolean' &&
    typeof settings.feedUrl === 'string' &&
    settings.feedUrl.length <= 2_048 &&
    (settings.feedUrl === '' || isAllowedUpdateUrl(settings.feedUrl)) &&
    (settings.channel === 'stable' || settings.channel === 'beta') &&
    typeof settings.autoCheck === 'boolean'
  );
}

function parseSemVer(value: string): SemVer | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: (match[4] ?? '')
      .split('.')
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
  };
}

export function compareUpdateVersions(left: string, right: string): number {
  const leftVersion = parseSemVer(left);
  const rightVersion = parseSemVer(right);
  if (!leftVersion || !rightVersion) throw new Error('Update manifest contains an invalid version');
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (leftVersion[key] !== rightVersion[key]) return leftVersion[key] - rightVersion[key];
  }
  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0;
  if (leftVersion.prerelease.length === 0) return 1;
  if (rightVersion.prerelease.length === 0) return -1;
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart;
    if (typeof leftPart === 'number') return -1;
    if (typeof rightPart === 'number') return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<UpdateManifest>;
  return (
    manifest.format === 'story-blueprint-update' &&
    manifest.version === 1 &&
    (manifest.channel === 'stable' || manifest.channel === 'beta') &&
    typeof manifest.latestVersion === 'string' &&
    Boolean(parseSemVer(manifest.latestVersion)) &&
    (manifest.releaseDate === undefined || typeof manifest.releaseDate === 'string') &&
    (manifest.notes === undefined ||
      (typeof manifest.notes === 'string' && manifest.notes.length <= 100_000)) &&
    (manifest.installerUrl === undefined || typeof manifest.installerUrl === 'string') &&
    (manifest.portableUrl === undefined || typeof manifest.portableUrl === 'string') &&
    (manifest.installerSha512 === undefined ||
      (typeof manifest.installerSha512 === 'string' &&
        /^[A-Za-z0-9+/]{86}==$/.test(manifest.installerSha512))) &&
    (manifest.portableSha512 === undefined ||
      (typeof manifest.portableSha512 === 'string' &&
        /^[A-Za-z0-9+/]{86}==$/.test(manifest.portableSha512))) &&
    (manifest.installerSize === undefined ||
      (Number.isSafeInteger(manifest.installerSize) && manifest.installerSize > 0)) &&
    (manifest.portableSize === undefined ||
      (Number.isSafeInteger(manifest.portableSize) && manifest.portableSize > 0)) &&
    (manifest.signature === undefined ||
      (typeof manifest.signature === 'object' &&
        manifest.signature !== null &&
        manifest.signature.algorithm === 'ed25519' &&
        typeof manifest.signature.keyId === 'string' &&
        /^[A-Za-z0-9._-]{1,64}$/.test(manifest.signature.keyId) &&
        typeof manifest.signature.value === 'string' &&
        /^[A-Za-z0-9+/]{86}==$/.test(manifest.signature.value)))
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function verifyUpdateManifestSignature(
  manifest: UpdateManifest,
  trustedKeys: Readonly<Record<string, string>> = TRUSTED_UPDATE_KEYS,
): boolean {
  if (!manifest.signature) return false;
  const publicKeyDer = trustedKeys[manifest.signature.keyId];
  if (!publicKeyDer || manifest.signature.algorithm !== 'ed25519') return false;
  const signedPayload = { ...manifest };
  delete signedPayload.signature;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(signedPayload), 'utf8'),
      createPublicKey({
        key: Buffer.from(publicKeyDer, 'base64'),
        format: 'der',
        type: 'spki',
      }),
      Buffer.from(manifest.signature.value, 'base64'),
    );
  } catch {
    return false;
  }
}

function resolveUpdateUrl(feedUrl: string, candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(candidate, feedUrl);
  } catch {
    throw new Error('Update manifest contains an invalid download URL');
  }
  if (!isAllowedUpdateUrl(resolved.toString())) {
    throw new Error('Update download URLs must use HTTPS (localhost HTTP is allowed)');
  }
  return resolved.toString();
}

function resolveManifestUrl(feedUrl: string, channel: UpdateSettings['channel']): string {
  const url = new URL(feedUrl);
  if (url.pathname.toLowerCase().endsWith('.json')) return url.toString();
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return new URL(`${channel}.json`, url).toString();
}

export async function checkUpdateFeed(
  currentVersion: string,
  settings: UpdateSettings,
  fetchManifest: typeof fetch = fetch,
  trustedKeys?: Readonly<Record<string, string>>,
): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  if (!settings.enabled || !settings.feedUrl) {
    return { status: 'disabled', currentVersion, checkedAt };
  }
  try {
    const manifestUrl = resolveManifestUrl(settings.feedUrl, settings.channel);
    const response = await fetchManifest(manifestUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Update feed returned HTTP ${response.status}`);
    const finalManifestUrl = response.url || manifestUrl;
    if (!isAllowedUpdateUrl(finalManifestUrl)) {
      throw new Error('Update feed redirected to an unsafe URL');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_UPDATE_MANIFEST_BYTES) {
      throw new Error('Update manifest is too large');
    }
    const value: unknown = JSON.parse(text);
    if (!isUpdateManifest(value)) throw new Error('Invalid Story Blueprint update manifest');
    if (!verifyUpdateManifestSignature(value, trustedKeys)) {
      throw new Error('Update manifest signature is missing, invalid, or untrusted');
    }
    if (value.channel !== settings.channel) {
      return { status: 'up-to-date', currentVersion, checkedAt };
    }
    const installerUrl = resolveUpdateUrl(finalManifestUrl, value.installerUrl);
    const portableUrl = resolveUpdateUrl(finalManifestUrl, value.portableUrl);
    const status =
      compareUpdateVersions(value.latestVersion, currentVersion) > 0 ? 'available' : 'up-to-date';
    return {
      status,
      currentVersion,
      latestVersion: value.latestVersion,
      releaseDate: value.releaseDate,
      notes: value.notes,
      installerUrl,
      portableUrl,
      installerSha512: value.installerSha512,
      portableSha512: value.portableSha512,
      installerSize: value.installerSize,
      portableSize: value.portableSize,
      checkedAt,
    };
  } catch (error) {
    let errorMsg = 'Update check failed';
    if (error instanceof Error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const causeDetail = cause?.code || cause?.message;
      errorMsg = causeDetail ? `${error.message} (${causeDetail})` : error.message;
    } else if (error) {
      errorMsg = String(error);
    }
    return {
      status: 'error',
      currentVersion,
      checkedAt,
      error: errorMsg,
    };
  }
}
