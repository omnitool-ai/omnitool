/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const fs = require('fs');
const crypto = require('node:crypto');
const admzip = require('adm-zip');
const path = require('node:path');
const { compare } = require('compare-versions');

const NodeProcessEnv = {
  development: 'development',
  production: 'production',
}

async function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function getSHA256Checksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

function unzip(srcFilePath, destDir) {
  const zip = new admzip(srcFilePath);
  zip.extractAllTo(destDir, true, true);
}

function statuslogger(data) {
  return new Promise((resolve) => {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    if (!process.stdout.write(data)) {
      process.stdout.once('drain', resolve);
    } else {
      process.nextTick(resolve);
    }
  });
}

async function checkInternet() {
  try {
    void (await require('node:dns').promises.lookup('github.com'));
    return true;
  } catch (_e) {
    return false;
  }
}

async function checkGitForUpdates() {
  const local_package = require('../package.json');
  try {
    const result = await fetch('https://raw.githubusercontent.com/omnitool-ai/omnitool/main/package.json');
    const remote_package = await result.json();
    if (compare(remote_package.version, local_package.version, '>')) {
      return { hasUpdates: true, remote: remote_package.version, local: local_package.version };
    } else {
      return { hasUpdates: false, remote: remote_package.version, local: local_package.version }
    }  
  }
  catch(e) {
    console.warn('Unable to fetch updates. Continuing...');
    return { hasUpdates: false, remote: undefined, local: local_package.version }
  }
}

function omniCwd() {
  return path.resolve(__dirname) + '/../';
}

module.exports = {
  getSHA256Checksum,
  unzip,
  sleep,
  statuslogger,
  checkInternet,
  omniCwd,
  checkGitForUpdates,
  NodeProcessEnv
};
