const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const manifest = require('../package.json');
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(packed.files.map(({ path }) => path));
for (const entry of [...manifest.n8n.nodes, ...manifest.n8n.credentials]) {
  assert(files.has(entry), `Missing runtime entry point: ${entry}`);
}
assert(files.has('dist/nodes/Webdecoy/webdecoy.svg'), 'Missing node icon');
assert(files.has('dist/nodes/Webdecoy/webdecoy.dark.svg'), 'Missing dark node icon');
for (const file of files) {
  assert(!file.endsWith('.tsbuildinfo'), `Build cache bundled: ${file}`);
  assert(file === 'package.json' || !file.endsWith('/package.json'), `Nested manifest bundled: ${file}`);
  assert(['package.json', 'README.md', 'LICENSE'].includes(file) || file.startsWith('dist/nodes/') || file.startsWith('dist/credentials/'), `Unexpected package file: ${file}`);
}
console.log(`Package layout passed: ${files.size} files; all runtime entry points and icons present.`);
