/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import fs from 'fs-extra';

export async function moveDirectory(source: string, target: string): Promise<boolean> {
  try {
    await fs.move(source, target, { overwrite: false });
    return true; // Return true on success
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    return false; // Return false on failure
  }
}
