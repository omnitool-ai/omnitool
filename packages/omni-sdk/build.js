/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */


import esbuild from "esbuild"

console.log("Building omni_sdk...")
esbuild.build({
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  format: 'esm',
  bundle: true,
  platform: 'node',
  tsconfig: 'tsconfig.json',
  logLevel: 'info',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  //external: ['markdown', 'handlebars']
}).then(() => console.log("Building omni_sdk done"))
.catch(() => process.exit(1));

