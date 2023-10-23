/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { moveDirectory } from '../helper/fs-helpers.js';
import path from 'path';

// Migration script for older versions of omniTool

export async function migrate_20231014() {
  // "Move files from /etc/db to var/db"
  const sourceDirectory = path.join(process.cwd(), 'etc', 'db');
  const targetDirectory = path.join(process.cwd(), 'data.local', 'db');

  const success = await moveDirectory(sourceDirectory, targetDirectory);
  if (success) {
    console.log(`Migration: Successfully moved files from ${sourceDirectory} to ${targetDirectory}`);
  }
}

export async function migrate_20231014_1() {
  // "Move files from /etc/db to var/db"
  const sourceDirectory = path.join(process.cwd(), 'etc', 'keystore');
  const targetDirectory = path.join(process.cwd(), 'data.local', 'keystore');

  const success = await moveDirectory(sourceDirectory, targetDirectory);
  if (success) {
    console.log(`Migration: Successfully moved files from ${sourceDirectory} to ${targetDirectory}`);
  }
}

export async function migrate_20231014_2() {
  // "Move files from /etc/db to var/db"
  let sourceDirectory = path.join(process.cwd(), 'etc');
  let targetDirectory = path.join(process.cwd(), 'config.default');

  let success = await moveDirectory(sourceDirectory, targetDirectory);
  if (success) {
    console.log(`Migration: Successfully moved files from ${sourceDirectory} to ${targetDirectory}`);
  }

  sourceDirectory = path.join(process.cwd(), 'var');
  targetDirectory = path.join(process.cwd(), 'data.local');

  success = await moveDirectory(sourceDirectory, targetDirectory);
  if (success) {
    console.log(`Migration: Successfully moved files from ${sourceDirectory} to ${targetDirectory}`);
  }
}
