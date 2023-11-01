/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import esbuild from 'esbuild';
import assert from 'node:assert';

const environment = process.argv[2];
assert(environment === 'production' || environment === 'development', 'Invalid environment ' + environment);

console.log(`Building omni-client-services (${environment})...`);
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
    sourcemap: true
  })
  .then(() => console.log('Building omni-client-services done'))
  .catch(() => process.exit(1));
