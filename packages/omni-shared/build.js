/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import esbuild from 'esbuild';
import assert from 'node:assert';

const environment = process.argv[2];
assert(environment === 'production' || environment === 'development', 'Invalid environment ' + environment);

console.log(`Building omni-shared (${environment})...`);
esbuild
  .build({
    entryPoints: ['src/index.ts'],
    outdir: 'lib',
    format: 'esm',
    color: true,
    bundle: true,
    platform: 'node',
    tsconfig: 'tsconfig.json',
    logLevel: 'warning',
    target: 'es2020',
    define: {
      'process.env.NODE_ENV': `"${environment}"`
    },
    minify: true,
    sourcemap: true,
    external: ['axios', 'consola', 'insane']
  })
  .then(() => console.log('Building omni-shared done'))
  .catch(() => process.exit(1));