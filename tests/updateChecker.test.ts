import { describe, expect, it } from 'vitest';
import { sign } from 'node:crypto';
import {
  checkUpdateFeed,
  compareUpdateVersions,
  isAllowedUpdateUrl,
  isUpdateSettings,
} from '../packages/editor/src/main/updateChecker';
import type { UpdateManifest, UpdateSettings } from '../packages/editor/src/shared/electronApi';

const testPrivateKey = `-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIItH58ldg6QtugE/rPc9IWF1PeF6y5akaaMESoPQPzsl\n-----END PRIVATE KEY-----\n`;
const testTrustedKeys = {
  'release-2026': 'MCowBQYDK2VwAyEAo8pO3oql9TCZQMXM6Wfzqcx+ba2tTklJt+OFaOgj+1g=',
};
function signed(manifest: Omit<UpdateManifest, 'signature'>): UpdateManifest {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  };
  return {
    ...manifest,
    signature: {
      algorithm: 'ed25519',
      keyId: 'release-2026',
      value: sign(null, Buffer.from(canonical(manifest)), testPrivateKey).toString('base64'),
    },
  };
}

const settings: UpdateSettings = {
  enabled: true,
  feedUrl: 'https://updates.example.com/stable/update.json',
  channel: 'stable',
  autoCheck: false,
};

function response(manifest: UpdateManifest): typeof fetch {
  return async () =>
    new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

describe('application update checker', () => {
  it('accepts HTTPS and localhost HTTP while rejecting remote HTTP and unsafe protocols', () => {
    expect(isAllowedUpdateUrl('https://updates.example.com/update.json')).toBe(true);
    expect(isAllowedUpdateUrl('http://localhost:8080/update.json')).toBe(true);
    expect(isAllowedUpdateUrl('http://127.0.0.1:8080/update.json')).toBe(true);
    expect(isAllowedUpdateUrl('http://updates.example.com/update.json')).toBe(false);
    expect(isAllowedUpdateUrl('file:///tmp/update.json')).toBe(false);
    expect(
      isUpdateSettings({ ...settings, feedUrl: 'http://updates.example.com/update.json' }),
    ).toBe(false);
  });

  it('orders stable and prerelease SemVer values correctly', () => {
    expect(compareUpdateVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareUpdateVersions('0.2.0-beta.2', '0.2.0-beta.1')).toBeGreaterThan(0);
    expect(compareUpdateVersions('0.2.0', '0.2.0-beta.2')).toBeGreaterThan(0);
    expect(compareUpdateVersions('0.2.0-beta.2', '0.2.0')).toBeLessThan(0);
  });

  it('returns an available update and resolves relative artifact URLs', async () => {
    const result = await checkUpdateFeed(
      '0.1.0',
      settings,
      response(signed({
        format: 'story-blueprint-update',
        version: 1,
        channel: 'stable',
        latestVersion: '0.2.0',
        releaseDate: '2026-08-20T00:00:00.000Z',
        notes: 'Update checker test.',
        installerUrl: './StoryBlueprint-Setup-0.2.0-x64.exe',
        portableUrl: './StoryBlueprint-Portable-0.2.0-x64.exe',
      })),
      testTrustedKeys,
    );

    expect(result).toMatchObject({
      status: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      installerUrl: 'https://updates.example.com/stable/StoryBlueprint-Setup-0.2.0-x64.exe',
      portableUrl: 'https://updates.example.com/stable/StoryBlueprint-Portable-0.2.0-x64.exe',
    });
  });

  it('resolves a manually entered base URL to the selected channel manifest', async () => {
    let requestedUrl = '';
    const result = await checkUpdateFeed(
      '0.1.0',
      { ...settings, feedUrl: 'https://updates.example.com/story-blueprint', channel: 'beta' },
      async (input) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify(signed({
            format: 'story-blueprint-update',
            version: 1,
            channel: 'beta',
            latestVersion: '0.2.0-beta.1',
          })),
        );
      },
      testTrustedKeys,
    );

    expect(requestedUrl).toBe('https://updates.example.com/story-blueprint/beta.json');
    expect(result.status).toBe('available');
  });

  it('does not offer a different channel and rejects invalid manifests without throwing', async () => {
    const wrongChannel = await checkUpdateFeed(
      '0.1.0',
      settings,
      response(signed({
        format: 'story-blueprint-update',
        version: 1,
        channel: 'beta',
        latestVersion: '0.3.0-beta.1',
      })),
      testTrustedKeys,
    );
    expect(wrongChannel.status).toBe('up-to-date');

    const invalid = await checkUpdateFeed('0.1.0', settings, async () => new Response('{}'));
    expect(invalid).toMatchObject({
      status: 'error',
      error: 'Invalid Story Blueprint update manifest',
    });
  });

  it('rejects unsigned or tampered manifests', async () => {
    const unsigned = await checkUpdateFeed('0.1.0', settings, response({
      format: 'story-blueprint-update', version: 1, channel: 'stable', latestVersion: '0.2.0',
    } as UpdateManifest));
    expect(unsigned.status).toBe('error');
    expect(unsigned.error).toMatch(/signature/);
    const manifest = signed({ format: 'story-blueprint-update', version: 1, channel: 'stable', latestVersion: '0.2.0' });
    manifest.latestVersion = '0.3.0';
    const tampered = await checkUpdateFeed('0.1.0', settings, response(manifest), testTrustedKeys);
    expect(tampered.status).toBe('error');
  });
});
