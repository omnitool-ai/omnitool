/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */


import esbuild from "esbuild"

console.log("Building omni-sockets...")
esbuild.build({
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  format: 'esm',
  bundle: true,
  platform: 'node',
  tsconfig: 'tsconfig.json',
  logLevel: 'info',
  target: 'es2020',
  sourcemap: true,
  external: ['axios', 'jsonata']
}).then(() => console.log("Building omni-sockets done"))
.catch(() => process.exit(1));

