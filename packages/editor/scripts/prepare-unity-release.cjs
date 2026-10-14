const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { gunzipSync } = require('node:zlib');

const workspaceRoot = resolve(__dirname, '../../..');
const packageName = 'StoryBlueprintAdapter.unitypackage';

// Read Unity's native tar archive without extracting or rewriting it.
function readPackage(bytes) {
  const tar = gunzipSync(bytes);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) {
      throw new Error('Invalid Unity package archive');
    }
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const assets = new Map();
  for (const [name, pathname] of entries) {
    if (!name.endsWith('/pathname')) continue;
    const guid = name.split('/')[0];
    const meta = entries.get(`${guid}/asset.meta`);
    if (!/^[0-9a-f]{32}$/.test(guid) || !meta ||
        !new RegExp(`^guid: ${guid}\r?$`, 'm').test(meta.toString('utf8'))) {
      throw new Error(`Invalid Unity asset GUID: ${name}`);
    }
    const assetPath = pathname.toString('utf8').trim();
    if (assets.has(assetPath)) throw new Error(`Duplicate Unity asset: ${assetPath}`);
    assets.set(assetPath, { bytes: entries.get(`${guid}/asset`), meta });
  }
  return assets;
}

function validateSources(assets, sourceRoot) {
  function visit(directory, relative) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.name.endsWith('.meta')) continue;
      const relativePath = `${relative}/${item.name}`;
      const path = join(directory, item.name);
      if (item.isDirectory()) { visit(path, relativePath); continue; }
      const exported = assets.get(`Assets/StoryBlueprintAdapter/${relativePath}`);
      if (!exported?.bytes || !exported.bytes.equals(readFileSync(path)) ||
          !exported.meta.equals(readFileSync(`${path}.meta`))) {
        throw new Error(`Unity package is missing or outdated: ${relativePath}. Re-export Assets/StoryBlueprintAdapter using Unity's Export Package.`);
      }
    }
  }
  for (const folder of ['Runtime', 'Editor']) visit(join(sourceRoot, folder), folder);
}

function prepareUnityRelease(root = workspaceRoot) {
  const input = resolve(root, 'integrations/unity', packageName);
  if (!existsSync(input)) {
    throw new Error(`Missing ${input}. Export Assets/StoryBlueprintAdapter from RuntimeDemo with Unity and save to this path.`);
  }
  const bytes = readFileSync(input);
  validateSources(readPackage(bytes), resolve(root, 'integrations/unity/samples/RuntimeDemo/Assets/StoryBlueprintAdapter'));
  const output = resolve(root, 'release');
  mkdirSync(output, { recursive: true });
  copyFileSync(input, join(output, packageName));
  const metadata = {
    format: 'story-blueprint-unity-adapter',
    version: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
    url: `./${packageName}`,
    size: bytes.length,
    sha512: createHash('sha512').update(bytes).digest('base64'),
    unityVersion: '2022.3 LTS',
    dependencies: { 'com.unity.nuget.newtonsoft-json': '3.2.1', 'com.unity.ugui': '1.0.0' },
  };
  writeFileSync(join(output, 'unity-adapter.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

if (require.main === module) {
  try {
    const metadata = prepareUnityRelease();
    console.log(`Prepared release/${packageName} (${metadata.size} bytes) and unity-adapter.json`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareUnityRelease, readPackage, validateSources };
