import { describe, expect, it } from 'vitest';
import {
  checkUpdateFeed,
  compareUpdateVersions,
  isAllowedUpdateUrl,
  isUpdateSettings,
} from '../packages/editor/src/main/updateChecker';
import type { UpdateManifest, UpdateSettings } from '../packages/editor/src/shared/electronApi';

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
      response({
        format: 'story-blueprint-update',
        version: 1,
        channel: 'stable',
        latestVersion: '0.2.0',
        releaseDate: '2026-08-20T00:00:00.000Z',
        notes: 'Update checker test.',
        installerUrl: './StoryBlueprint-Setup-0.2.0-x64.exe',
        portableUrl: './StoryBlueprint-Portable-0.2.0-x64.exe',
      }),
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
          JSON.stringify({
            format: 'story-blueprint-update',
            version: 1,
            channel: 'beta',
            latestVersion: '0.2.0-beta.1',
          }),
        );
      },
    );

    expect(requestedUrl).toBe('https://updates.example.com/story-blueprint/beta.json');
    expect(result.status).toBe('available');
  });

  it('does not offer a different channel and rejects invalid manifests without throwing', async () => {
    const wrongChannel = await checkUpdateFeed(
      '0.1.0',
      settings,
      response({
        format: 'story-blueprint-update',
        version: 1,
        channel: 'beta',
        latestVersion: '0.3.0-beta.1',
      }),
    );
    expect(wrongChannel.status).toBe('up-to-date');

    const invalid = await checkUpdateFeed('0.1.0', settings, async () => new Response('{}'));
    expect(invalid).toMatchObject({
      status: 'error',
      error: 'Invalid Story Blueprint update manifest',
    });
  });
});
