const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');

const workspaceRoot = resolve(__dirname, '../../..');
const packageId = 'com.storyblueprint.runtime';
const packagePath = 'integrations/unity/samples/RuntimeDemo/Packages/com.storyblueprint.runtime';
const repositoryUrl = 'https://github.com/Cola-s-Commune/StoryBlueprint.git';

function validatePackage(root) {
  const packageRoot = resolve(root, packagePath);
  const manifestPath = join(packageRoot, 'package.json');
  if (!existsSync(manifestPath)) throw new Error(`Missing UPM package manifest: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== packageId || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version || '')) {
    throw new Error('UPM package name or version is invalid.');
  }
  if (manifest.unity !== '2022.3' || manifest.dependencies?.['com.unity.nuget.newtonsoft-json'] !== '3.2.1') {
    throw new Error('UPM package must target Unity 2022.3 and declare Newtonsoft JSON 3.2.1.');
  }
  const seen = new Set();
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'package.json' || entry.name === 'README.md') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.meta')) continue;
      const meta = readFileSync(path, 'utf8');
      const guid = /^guid: ([0-9a-f]{32})$/m.exec(meta)?.[1];
      if (!guid || seen.has(guid)) throw new Error(`Invalid or duplicate Unity GUID in ${path}`);
      seen.add(guid);
    }
  }
  walk(packageRoot);
  for (const required of [
    'Runtime/Core/StoryRuntime.cs',
    'Runtime/Unity/UnityStoryHost.cs',
    'Runtime/Demo/StoryBlueprintStoryPlayer.prefab',
    'Editor/UnityStoryImporterWindow.cs',
  ]) {
    if (!existsSync(join(packageRoot, required))) throw new Error(`UPM package is missing ${required}`);
  }
  return { packageRoot, manifest };
}

function prepareUnityRelease(root = workspaceRoot) {
  const { manifest } = validatePackage(root);
  const output = resolve(root, 'release');
  mkdirSync(output, { recursive: true });
  const gitUrl = `${repositoryUrl}?path=/${packagePath}#main`;
  const metadata = {
    format: 'story-blueprint-unity-adapter',
    packageId,
    version: manifest.version,
    gitUrl,
    unityVersion: manifest.unity,
    dependencies: manifest.dependencies,
  };
  writeFileSync(join(output, 'unity-adapter.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

if (require.main === module) {
  try {
    const metadata = prepareUnityRelease();
    console.log(`Prepared UPM installation metadata for ${metadata.packageId}@${metadata.version}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareUnityRelease, validatePackage };
