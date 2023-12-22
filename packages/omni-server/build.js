/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import esbuild from 'esbuild';
import assert from 'node:assert';
import fs from 'node:fs';

const clean = process.argv[2] === 'clean';
if (clean) {
  console.log('Cleaning omni-server...');
  if (fs.existsSync('dist')) {
    fs.rmdirSync('dist', { recursive: true, force: true });
  }
  fs.rmSync('tsconfig.tsbuildinfo', { force: true });
  fs.rmSync('.eslintcache', { force: true });
  process.exit(0);
}

const environment = process.argv[2];
assert(environment === 'production' || environment === 'development', 'Invalid environment ' + environment);

console.log(`Building omni-server (${environment})...`);
esbuild
.build({
  entryPoints: ['src/run.ts'],
  outdir: 'dist',
  color: true,
  bundle: true,
  platform: 'node',
  format: 'esm',
  tsconfig: 'tsconfig.json',
  logLevel: 'warning',
  packages: 'external',
  sourcemap: 'linked',
})
.then(() => console.log('Building omni-server done'))
.catch(() => process.exit(1));
