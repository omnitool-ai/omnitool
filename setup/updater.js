/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('child_process');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const { getSHA256Checksum, statuslogger, omniCwd } = require('./utils.js');
const { extract } = require('tar');

const config = JSON.parse(
  fs.readFileSync(path.join(omniCwd(), 'package.json'), { encoding: 'utf-8' }));
const path_destination_folder = path.join(omniCwd(), 'setup', 'updates');
const remote_releases_url = config.dependenciesBin.updates_base_url;

function _get_updater_url() {
  const platform = process.platform;
  const arch = process.arch;
  assert(platform === 'win32' || platform === 'darwin' || platform === 'linux');
  assert(arch === 'x64' || arch === 'arm64');
  return `${remote_releases_url}/${_get_updater_file()}`;
}

function _get_updater_checksum_url() {
  return `${remote_releases_url}/${_get_updater_checksum_file()}`;
}

function _get_updater_checksum_file() {
  const platform = process.platform;
  const arch = process.arch;
  assert(platform === 'win32' || platform === 'darwin' || platform === 'linux');
  assert(arch === 'x64' || arch === 'arm64');
  return `${platform}_${arch}_updates_checksum.txt`;
}

function _get_updater_file() {
  const platform = process.platform;
  const arch = process.arch;
  assert(platform === 'win32' || platform === 'darwin' || platform === 'linux');
  assert(arch === 'x64' || arch === 'arm64');
  return `${platform}_${arch}_updates.tar.gz`;
}

/**
 * Fetches the contents of a remote file using curl.
 * @param {string} url - The URL of the file to fetch.
 * @returns {Promise<string>} - Resolves with the file contents as a string.
 */
function curl_remote_textfile(url) {
  return new Promise((resolve, reject) => {
    const cmd = `curl -L "${url}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
        return;        
      }

      // test for SHA256
      const regexExp = /^[a-f0-9]{64}$/gi;
      if (!regexExp.test(stdout)) {
        reject('Failed to retrieve valid SHA256 checksum.');
        return;
      }
      console.log('Remote found: ' + stdout);
      resolve(stdout);
    });
  });
}

async function get_remote_checksum() {
  // update if different
  console.log('Checking for updates...' + _get_updater_checksum_url());
  return await curl_remote_textfile(_get_updater_checksum_url());
}

function verify_checksum(incoming) {
  const checksum_file_path = path.join(path_destination_folder, _get_updater_checksum_file());
  if (!fs.existsSync(path_destination_folder)) {
    fs.mkdirSync(path_destination_folder);
    return false;
  }
  // if local file doesn't exist create and return checksum fail
  if (!fs.existsSync(checksum_file_path)) {
    return false;
  }
  const local_checksum = fs.readFileSync(checksum_file_path, { encoding: 'ascii' });
  return local_checksum === incoming;
}

async function run_update(new_checksum) {
  // download bundle
  let retries = 2;
  const bundle_file = _get_updater_file();
  console.log('Downloading update bundle ' + bundle_file);
  while (retries > 0) {
    const download_cmd = `curl -L "${_get_updater_url()}" -o ${bundle_file}`;
    execSync(download_cmd, { cwd: path_destination_folder, stdio: 'inherit' });
    // verify checksum
    const download_checksum = await getSHA256Checksum(path.join(path_destination_folder, bundle_file));
    if (new_checksum !== download_checksum) {
      console.log(`Checksum failed expected ${new_checksum} got ${download_checksum}`);
      fs.rmSync(path.join(path_destination_folder, bundle_file), { force: true });
      retries--;
      console.log(`Retrying download...${retries} retries`);
      if (retries === 0) {
        throw new Error(`Update bundle checksum failed too many times. Aborting.`);
      }
    } else {
      console.log(`Downloaded ${path.join(path_destination_folder, bundle_file)}`);
      break;
    }
  }
  // copy to project base dir and unpack
  fs.copyFileSync(path.join(path_destination_folder, bundle_file), path.join(omniCwd(), bundle_file));
  console.log(`Extracting ${bundle_file}`);
  const exclude_executable = process.platform === 'win32' ? 'omnitool.exe' : 'omnitool';
  await extract({
    file: bundle_file,
    filter: (p) => {
      const filepath = path.parse(p);
      if (p === exclude_executable) {
        return false;
      } else {
        void statuslogger(`Unpacking ${filepath.name}${filepath.ext}`);
        return true;
      }
    }
  });
  // cleanup
  fs.rmSync(path.join(path_destination_folder, bundle_file));
}

function seal_update(new_checksum) {
  assert(new_checksum !== null);
  const checksum_file_path = path.join(path_destination_folder, _get_updater_checksum_file());
  fs.writeFileSync(checksum_file_path, new_checksum);
}

async function update_build() {
  // skip updates if there's any remote failures
  let need_update = false;
  let remote_checksum = null;
  try {
    remote_checksum = await get_remote_checksum();
    need_update = !verify_checksum(remote_checksum);
  } catch (e) {
    console.warn('Error fetching update checksum. Skipping updates.');
    console.error(e);
    // continue
    need_update = false;
  }
  if (need_update) {
    try {
      console.log('New version found! Updating...');
      await run_update(remote_checksum);
      seal_update(remote_checksum);
      console.log(`Build updated to ${remote_checksum}`);
      return true;
    } catch (e) {
      console.log('Update failed, cleaning up...');
      // always reset on any update error
      fs.rmSync(path_destination_folder, { recursive: true, force: true });
      throw e;
    }
  } else {
    console.log('Current version is the latest available.');
    return false;
  }
}

module.exports = {
  update_build
};
