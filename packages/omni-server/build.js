/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import esbuild from 'esbuild';
import assert from 'node:assert';
import { execSync } from 'node:child_process';

const environment = process.argv[2];
assert(environment === 'production' || environment === 'development', 'Invalid environment ' + environment);

console.log(`Building omni-server (${environment})...`);
switch(environment) {
    case 'production':
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
          define: {
            'process.env.NODE_ENV': `"${environment}"`
          },
          sourcemap: false,
          external: ['sharp', 'better-sqlite3']
        })
        .then(() => console.log('Building omni-server done'))
        .catch(() => process.exit(1));
        break;      
    case 'development':
        execSync('tsc --build', { stdio: 'inherit' });
        break;      
}