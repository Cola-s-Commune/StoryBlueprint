import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function portal(fetch: ReturnType<typeof vi.fn>) {
  const elements = new Map<string, any>();
  for (const id of ['copy-unity-adapter-url', 'unity-adapter-version', 'unity-adapter-git-url']) {
    elements.set(id, { textContent: '', disabled: true });
  }
  let copied = '';
  const context: any = { URL, fetch, window: { location: { href: 'https://example.com/' } },
    navigator: { clipboard: { writeText: async (text: string) => { copied = text; } } },
    showToast() {},
    document: { readyState: 'loading', addEventListener() {}, getElementById: (id: string) => elements.get(id) } };
  runInNewContext(readFileSync(resolve(__dirname, '../portal/app.js'), 'utf8'), context);
  return { elements, context, getCopied: () => copied };
}

describe('Unity Adapter portal UPM install', () => {
  it('shows and copies the Git package URL from release metadata', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      format: 'story-blueprint-unity-adapter', packageId: 'com.storyblueprint.runtime', version: '0.1.1',
      gitUrl: 'https://github.com/Cola-s-Commune/StoryBlueprint.git?path=/integrations/unity/samples/RuntimeDemo/Packages/com.storyblueprint.runtime#main',
    }) });
    const { elements, context, getCopied } = portal(fetch);
    await context.loadUnityAdapter('https://example.com/updates/stable.json');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/updates/unity-adapter.json');
    expect(elements.get('unity-adapter-git-url').textContent).toBe('https://github.com/Cola-s-Commune/StoryBlueprint.git?path=/integrations/unity/samples/RuntimeDemo/Packages/com.storyblueprint.runtime#main');
    expect(elements.get('copy-unity-adapter-url').disabled).toBe(false);
    expect(elements.get('unity-adapter-version').textContent).toBe('v0.1.1');
    await elements.get('copy-unity-adapter-url').onclick();
    expect(getCopied()).toBe(elements.get('unity-adapter-git-url').textContent);
  });

  it('keeps copy disabled when metadata is missing', async () => {
    const { elements, context } = portal(vi.fn().mockResolvedValue({ ok: false }));
    await context.loadUnityAdapter('https://example.com/updates/stable.json');
    expect(elements.get('copy-unity-adapter-url').disabled).toBe(true);
    expect(elements.get('copy-unity-adapter-url').textContent).toBe('UPM 地址暂不可用');
  });
});
