/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const { fork, spawn, exec, execSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { assert } = require('console');
const { ensure } = require('./pocketdbutils.js');
const { sleep, checkGitForUpdates, omniCwd } = require('./utils.js');
const { ensureDirSync } = require('fs-extra');
const { update_build } = require('./updater.js');
const readline = require('node:readline');
const fs = require('node:fs');
const { migrate_from_pocket } = require('./pocket2sqlite.js');

const { copyFileSync, existsSync } = require('node:fs');
let args = process.argv.slice(2);

let server_entry = null;

const packagejson = JSON.parse(fs.readFileSync(path.join(omniCwd(), 'package.json'), { encoding: 'utf-8' }));
const { argv0 } = require('node:process');
const depjson = packagejson.dependenciesBin;
const platform = os.platform();
const arch = os.arch();

const IPC_CMD = 'cmd';
const IPC_CMD_restart = 'restart';
// move out of /setup/launcher.js where the mercs.yaml file exists
const project_abs_root = omniCwd();
const pocketbaseInstallPath = path.join(project_abs_root, depjson.root_dir, 'pocketbase');

let server_process = null;
let pretty_process_pid = [];
let child_processes = new Map();

function start_server(implicit_args) {
  assert(server_process === null);
  assert(server_entry !== null);

  // IMPORTANT: omnitool need to run from /mercs as root and launcher in setup/launcher.js
  const server_wd = path.join(project_abs_root, 'packages/omni-server');

  // derive the server entry file using absolute paths from launcher.js
  // this ensures we can also resolve whether clicking directy on .exe or launching from terminal
  const entrypath = path.join(server_wd, server_entry);
  console.log(`Server entry point resolved to ${entrypath}`);

  server_process = fork(entrypath, implicit_args.concat(args), { cwd: server_wd, execArgv: ['--inspect'] });
  pretty_process_pid.push(`|--OMNITOOL - Server PID ${server_process.pid}`);
  child_processes.set(server_process.pid, server_process);

  server_process.on('exit', (code) => {
    console.log(`Server exited with code ${code}`);
    process.exit(1);
  });
  server_process.on('error', (err) => {
    console.error(err);
    process.abort();
  });
  server_process.on('message', (message) => {
    switch (message[IPC_CMD]) {
      case IPC_CMD_restart:
        console.log('Server Restarting...');
        server_process.removeAllListeners('exit');
        server_process.kill();
        child_processes.delete(server_process.pid);
        server_process = null;
        // no need to re-open browser on restarts
        implicit_args = implicit_args.filter((e) => e !== '--openBrowser');
        args = args.filter((e) => e !== '--openBrowser');
        start_server(implicit_args);
        break;
    }
  });
}

function verifyConfig() {
  // check if dep version is defined
  if (packagejson.engines['pocketbase'] === undefined) {
    console.error(`Missing version definition for pocketbase DB in package.json engines`);
    return false;
  }
  // check if dep is defined
  if (depjson['pocketbase'] === undefined) {
    console.error(`Unable to find installer definition for pocketbase DB`);
    return false;
  }
  // check if there's an installer for the platform
  try {
    let zippath = depjson['pocketbase'].zipfile[platform][arch];
    if (zippath === undefined) {
      console.error(`Unable to find installer download URL for pocketbase DB`);
      return false;
    }
  } catch (e) {
    console.error(`Unable to find pocketbase installer definition for [${platform}][${arch}]`);
    return false;
  }
  return true;
}

function start_pocketbase() {
  const pocketDBProcess = spawn(path.join(pocketbaseInstallPath, 'pocketbase'), ['serve'], { stdio: 'inherit' });
  setup_listeners(pocketDBProcess, 'pocketbase');
  pretty_process_pid.push(`|--OMNITOOL - PocketBaseDB PID ${pocketDBProcess.pid}`);
  child_processes.set(pocketDBProcess.pid, pocketDBProcess);
}

async function migrate_pocketbase() {
  await migrate_from_pocket(pocketbaseInstallPath);
}

function start_vite() {
  const viteProcess = exec('yarn frontend');
  viteProcess.stderr.pipe(process.stderr);
  viteProcess.stdout.pipe(process.stdout);
  setup_listeners(viteProcess, 'vite debugger');
  pretty_process_pid.push(`|--OMNITOOL - Vite PID ${viteProcess.pid}`);
  child_processes.set(viteProcess.pid, viteProcess);
}

async function user_confirmation(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) =>
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

function setup_listeners(proc, name) {
  proc.on('uncaughtException', (err) => {
    console.err(err);
    user_confirmation('Oops something went wrong. Press any key to exit...').then(() => process.exit(1));
  });
  // terminate parent for whatever reason
  proc.on('exit', (code) => {
    console.log(`${name} ${proc.pid} exited with code ${code}`);
    process.exit(1);
  });
}

async function check_for_updates() {
  console.log('Checking for updates...');
  const result = await checkGitForUpdates();
  if (result.hasUpdates) {
    const input = await user_confirmation(
      `You are currently on ${result.local}.\nThere's a new version ${result.remote} available. Would you like to update first? [y/n]:`
    );
    if (input === 'y') {
      try {
        console.log('\nPlease run "git pull" to update your local repository followed by "yarn install" to update to the latest version.\n');
        process.exit(0);  
      }
      catch(e) {
        console.error(e);
        console.warn(`Update failed. Please try running [yarn start] again.`);
        process.exit(1);
      }
    } else {
      console.log(`Continuing with current build ${result.local}...`);
    }
  }
  else{
    console.log(`You are currently on the latest version available ${result.local}.`);
  }
}

async function run_development(server_args) {
  // const pocketready = await ensure(pocketbaseInstallPath);
  // if (!pocketready) {
  //   console.error('Fatal error setting up PocketBase DB');
  //   process.exit(1);
  // }
  start_vite();
  //await sleep(1000);
  //start_pocketbase();
  await migrate_pocketbase();
  await sleep(1000);
  start_server(server_args);
  log_processes();
}

async function run_production(server_args) {
  // const pocketready = await ensure(pocketbaseInstallPath);
  // if (!pocketready) {
  //   console.error('Fatal error setting up PocketBase DB');
  //   process.exit(1);
  // }
  // start_pocketbase();
  // await sleep(1000);
  await migrate_pocketbase();
  start_server(server_args);
  log_processes();
}

async function run_runtime_executable() {
  const didupdate = await update_build();
  if (didupdate) {
    console.log('Omnitool has been patched with an update and needed to close.');
    console.log('Please re-run the application!');
    console.log('Press any key to exit...');

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 0));
  } else {
    await run_production(['-l', '127.0.0.1', '--openBrowser']);
  }
}

function log_processes() {
  pretty_process_pid.forEach((e) => console.log(e));
}

async function ensure_wasm() {
  const { NodeProcessEnv } = await import('omni-shared');
  // --- Copy wasm models
  let wasmDir = null;
  switch (process.env.NODE_ENV) {
    case NodeProcessEnv.development:
      wasmDir = path.join(omniCwd(), 'packages/omni-server', 'config.local', 'wasm');
      break;
    case NodeProcessEnv.production:
      wasmDir = path.join(omniCwd(), 'packages/omni-server', 'dist');
      break;
  }
  assert(wasmDir !== null);
  ensureDirSync(wasmDir);
  if (!existsSync(path.join(wasmDir, 'tfjs-backend-wasm.wasm'))) {
    console.log('Installing WASM modules... nsfwjs/threaded/wasm');
    copyFileSync(
      path.join(omniCwd(), 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist', 'tfjs-backend-wasm.wasm'),
      path.join(wasmDir, 'tfjs-backend-wasm.wasm')
    );
  }
  if (!existsSync(path.join(wasmDir, 'tfjs-backend-wasm-simd.wasm'))) {
    console.log('Installing WASM modules... nsfwjs/threaded/simd ');
    copyFileSync(
      path.join(omniCwd(), 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist', 'tfjs-backend-wasm-simd.wasm'),
      path.join(wasmDir, 'tfjs-backend-wasm-simd.wasm')
    );
  }
}

if (!verifyConfig()) {
  process.exit(1);
}

process.on('exit', (code) => {
  child_processes.forEach((p) => p.kill());
  child_processes.clear();
});

process.on('uncaughtException', (err) => {
  console.error(err);
  user_confirmation(
    `Oops something went terribly wrong: \n\t ${err}\n\nPlease let us know!\n\nPress any key to exit...`
  ).then(() => process.exit(1));
});

pretty_process_pid.push(`OMNITOOL - Launcher PID ${process.pid}`);

// launched from omnitool executable - always production + updates
async function run() {
  const { NodeProcessEnv } = await import('omni-shared');
  const omnitool_exec = 'omnitool';
  if (argv0.includes(omnitool_exec)) {
    console.log('Runtime mode detected..launching');
    server_entry = 'dist/server.cjs';
    process.env.NODE_ENV ??= 'production';
    ensure_wasm();
    run_runtime_executable();
  } else {
    // detect help and just show that then exit
    if (args.includes('--help') || args.includes('-h')) {
      execSync('node dist/run.js --help', { cwd: 'packages/omni-server', stdio: 'inherit' });
      process.exit(0);
    }
    console.log(`OMNITOOL Environment ${process.env.NODE_ENV}`);
    switch (process.env.NODE_ENV) {
      case NodeProcessEnv.development:
        server_entry = `dist/run.js`;
        ensure_wasm();
        run_development([]);
        break;
      case NodeProcessEnv.production:
        server_entry = 'dist/run.js';
        await check_for_updates();
        ensure_wasm();
        run_production([]);
        break;
      default:
        throw new Error('Unhandled environment - ' + process.env.NODE_ENV);
    }
  }
}

run();
