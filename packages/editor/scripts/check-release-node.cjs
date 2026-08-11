const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    `Windows release builds require Node.js 22.12 or newer; current version is ${process.versions.node}.`,
  );
  process.exit(1);
}
