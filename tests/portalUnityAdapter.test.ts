import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function portal(fetch: ReturnType<typeof vi.fn>) {
  const elements = new Map<string, any>();
  for (const id of ['download-unity-adapter-btn', 'unity-adapter-version', 'unity-adapter-size', 'unity-adapter-sha', 'copy-unity-adapter-sha']) {
    const attributes = new Map([['aria-disabled', 'true']]);
    elements.set(id, { textContent: '', disabled: true, attributes,
      removeAttribute: (name: string) => attributes.delete(name) });
  }
  const context: any = { URL, fetch, window: { location: { href: 'https://example.com/' } },
    document: { readyState: 'loading', addEventListener() {}, getElementById: (id: string) => elements.get(id) } };
  runInNewContext(readFileSync(resolve(__dirname, '../portal/app.js'), 'utf8'), context);
  return { elements, context };
}

describe('Unity Adapter portal download', () => {
  it('resolves the package next to its metadata in the updates directory', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      format: 'story-blueprint-unity-adapter', version: '0.1.1', url: './StoryBlueprintAdapter.unitypackage',
      size: 98027, sha512: 'test-hash',
    }) });
    const { elements, context } = portal(fetch);
    await context.loadUnityAdapter('https://example.com/updates/stable.json');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/updates/unity-adapter.json');
    expect(elements.get('download-unity-adapter-btn').href).toBe('https://example.com/updates/StoryBlueprintAdapter.unitypackage');
    expect(elements.get('download-unity-adapter-btn').attributes.has('aria-disabled')).toBe(false);
    expect(elements.get('unity-adapter-version').textContent).toBe('v0.1.1');
    expect(elements.get('unity-adapter-sha').textContent).toBe('test-hash');
  });

  it('keeps the download unavailable when metadata is missing', async () => {
    const { elements, context } = portal(vi.fn().mockResolvedValue({ ok: false }));
    await context.loadUnityAdapter('https://example.com/updates/stable.json');
    expect(elements.get('download-unity-adapter-btn').href).toBeUndefined();
    expect(elements.get('download-unity-adapter-btn').textContent).toBe('Unity Adapter 暂未发布');
    expect(elements.get('copy-unity-adapter-sha').disabled).toBe(true);
  });
});
