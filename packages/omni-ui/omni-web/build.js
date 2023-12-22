/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import fs from 'node:fs';

const clean = process.argv[2] === 'clean';
if (clean) {
  console.log('Cleaning omni-web...');
  fs.rmSync('tsconfig.tsbuildinfo', { force: true });
  fs.rmSync('.eslintcache', { force: true });
  process.exit(0);
}