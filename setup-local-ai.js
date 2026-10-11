'use strict';
// One-time setup for Local AI. Run:  node setup-local-ai.js
// It installs WebLLM and bundles it into vendor/web-llm.js, a single file Neira loads from disk.
// (Needs an internet connection once. Developers only: the file ships inside the packaged app.)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const pkgDir = path.join(root, 'node_modules', '@mlc-ai', 'web-llm');

if (!fs.existsSync(pkgDir) || !fs.existsSync(path.join(root, 'node_modules', 'esbuild'))) {
    console.log('Installing @mlc-ai/web-llm and esbuild (dev dependencies)...');
    execSync('npm install --save-dev @mlc-ai/web-llm esbuild', { cwd: root, stdio: 'inherit' });
}

const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const entry = path.join(pkgDir, pkg.module || pkg.main || 'lib/index.js');
const outfile = path.join(root, 'vendor', 'web-llm.js');
fs.mkdirSync(path.dirname(outfile), { recursive: true });

require('esbuild').buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    outfile,
    external: ['fs', 'path', 'crypto', 'perf_hooks', 'worker_threads', 'ws', 'node:*'],
    logLevel: 'warning'
});

const mb = (fs.statSync(outfile).size / 1048576).toFixed(1);
console.log(`\nDone: vendor/web-llm.js (${mb} MB).`);
console.log('Restart Neira, open the assistant (Alt + A), press the gear icon and turn on Local AI.');
console.log('If you package the app, make sure ai.js and vendor/web-llm.js are included in your build "files".');