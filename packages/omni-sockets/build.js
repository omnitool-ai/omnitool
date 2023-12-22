/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import esbuild from 'esbuild';
import assert from 'node:assert';
import fs from 'node:fs';

const clean = process.argv[2] === 'clean';
if (clean) {
  console.log('Cleaning omni-sockets...');
  if (fs.existsSync('lib')) {
    fs.rmdirSync('lib', { recursive: true, force: true });
  }
  fs.rmSync('tsconfig.tsbuildinfo', { force: true });
  fs.rmSync('.eslintcache', { force: true });
  process.exit(0);
}

const environment = process.argv[2];
assert(environment === 'production' || environment === 'development', 'Invalid environment ' + environment);

console.log(`Building omni-sockets (${environment})...`);
esbuild
  .build({
    entryPoints: ['src/index.ts'],
    outdir: 'lib',
    format: 'esm',
    bundle: true,
    platform: 'node',
    tsconfig: 'tsconfig.json',
    logLevel: 'warning',
    target: 'es2020',
    sourcemap: 'linked',
    packages: 'external',
    define: {
      'process.env.NODE_ENV': `"${environment}"`
    }
  })
  .then(() => console.log('Building omni-sockets done'))
  .catch(() => process.exit(1));
