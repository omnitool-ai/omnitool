/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// NO THIRD PARTY DEPS
const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { omniCwd } = require('./utils.js');
const packagejson = JSON.parse(
  fs.readFileSync(path.join(omniCwd(), 'package.json'), { encoding: 'utf-8' }));
const { unzip, sleep } = require('./utils');
const depjson = packagejson.dependenciesBin;

const VERSION_MARKER = '##version##';
const DB_ID = 'pocketbase';

const platform = os.platform();
const arch = os.arch();

const ownedProcesses = new Array();

function verifyInstall(path) {
  return fs.existsSync(path);
}

function downloadURL() {
  let file = depjson[DB_ID].zipfile[platform][arch];
  let version = packagejson.engines[DB_ID];

  return `${depjson[DB_ID].base_url}/${file}`.replaceAll(VERSION_MARKER, version);
}

async function fetchAndExtract(zipfile, destdir) {
  const curl = `curl -L -o ${zipfile} ${downloadURL()}`;
  execSync(curl, { stdio: 'inherit' });
  console.log(`\nDownload completed, now extracting to ${path.dirname(destdir)}...`);
  unzip(zipfile, destdir);
}

async function createDefaultAdmin(installpath) {
  let timeout_guard = 10000;
  console.log('Pre-warm pocketbase...');
  let dbprocess = spawn(path.join(installpath, getExecutable()), ['serve'], { stdio: 'inherit' });
  ownedProcesses.push(dbprocess);
  // ensure initial boot of pocketbase to create base tables
  while (!fs.existsSync(path.join(installpath, 'pb_data'))) {
    await sleep(1000);
    timeout_guard -= 1000;
    if (timeout_guard <= 0) {
      console.error('Failed to initialize DB');
      process.exit(1);
    }
  }

  // ready to administrate
  console.log('Creating default DB Admin ' + depjson[DB_ID].admin);
  spawnSync(path.join(installpath, getExecutable()), ['admin', 'create', depjson[DB_ID].admin, depjson[DB_ID].admin]);
  // create default tables for OMNI
  console.log(`Success!`);
  let pbSchemas = require('../packages/omni-server/src/services/DBService/pb_schema.json');

  const PocketBase = (await import('pocketbase')).default;
  let pb = new PocketBase('http://127.0.0.1:8090');
  await pb.admins.authWithPassword(depjson[DB_ID].admin, depjson[DB_ID].admin);
  for (const schema of pbSchemas) {
    console.log('Creating collection - ' + schema.name);
    await pb.collections.create(schema);
    const record = pb.collection(schema.name);
    // validate get, if not found, throw
    await record.getList();
  }
  pb.autoCancellation(false);
  // shutdown pocketbase serve
  console.info('PocketBase initial configuration completed - READY FOR USE...');
  dbprocess.kill();
  ownedProcesses.pop();
}

// move to config
function getExecutable() {
  switch (`${platform}`) {
    case 'win32':
      return 'pocketbase.exe';
    case 'darwin':
      return 'pocketbase';
    case 'linux':
      return 'pocketbase';
  }
  throw new Error('Unhandled executable type for ' + platform);
}

function successCleanup(installpath) {
  fs.rmSync(installpath + '/_download.zip');
}

async function failCleanup(installpath) {
  console.error('Installation failed. Cleaning up.');
  while (ownedProcesses.length > 0) {
    ownedProcesses.pop().kill();
  }
  // there are cases when the shutdown isn't complete
  // and rm fails, we retry until it succeeds or throw
  let retries = 30;
  while (true) {
    try {
      fs.rmSync(installpath, { recursive: true, force: true });
      break;
    } catch (e) {
      if (retries-- <= 0) {
        throw e;
      }
      await sleep(100);
    }
  }
}

async function installPocketBase(installpath) {
  // create directory
  console.log('Creating dir ' + installpath);
  fs.mkdirSync(installpath, { recursive: true });
  const downloadfile = installpath + '/_download.zip';
  await fetchAndExtract(downloadfile, installpath);
  console.log('Installation successful');
  await createDefaultAdmin(installpath);
}

async function ensure(installpath) {
  // check if installed
  if (verifyInstall(path.join(installpath, getExecutable()))) {
    console.info(`Found installation for PocketBase`);
    return true;
  } else {
    console.info(`Missing PocketBase DB - Installing...`);
    try {
      await installPocketBase(installpath);
      successCleanup(installpath);
      return true;
    } catch (e) {
      console.error(e);
      await failCleanup(installpath);
      return false;
    }
  }
}

module.exports = {
  ensure
};
