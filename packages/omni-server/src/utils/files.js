/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check

import { Utils } from 'omni-shared';
import fs from 'fs/promises';
import path from 'path';

// @ts-ignore
async function fetchJsonFromUrl(url) {
  const json = await Utils.fetchJSON(url);
  return json;
}

// @ts-ignore
async function walkDirForExtension(filePaths, directory_path, extension) {
  const files = await fs.readdir(directory_path);
  for (const file of files) {
    const filepath = path.join(directory_path, file);
    const stats = await fs.stat(filepath);

    if (stats.isDirectory()) {
      filePaths = await walkDirForExtension(filePaths, filepath, extension);
    } else {
      if (path.extname(filepath) === extension) {
        filePaths.push(filepath);
      }
    }
  }

  return filePaths;
}

// @ts-ignore
async function readJsonFromDisk(jsonPath) {
  const jsonContent = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  return jsonContent;
}

// Function to validate directory existence
// @ts-ignore
async function validateDirectoryExists(path) {
  try {
    const stats = await fs.stat(path);
    return stats.isDirectory(); // Returns true if directory exists
  } catch {
    return false; // Returns false if directory doesn't exist
  }
}

// Function to validate file existence
// @ts-ignore
async function validateFileExists(path) {
  try {
    const stats = await fs.stat(path);
    return stats.isFile(); // Returns true if file exists
  } catch {
    return false; // Returns false if file doesn't exist
  }
}

export { walkDirForExtension, validateDirectoryExists, validateFileExists, readJsonFromDisk, fetchJsonFromUrl };
