/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// Import required modules
import { ensureDir } from 'fs-extra'
import fs from 'fs/promises'
import yaml from 'js-yaml'
import path from 'path'
import { simpleGit } from 'simple-git'
import {spawn} from 'child_process'
import os from 'os';

// Function to validate directory existence
async function validateDirectoryExists (path) {
  try {
    const stats = await fs.stat(path)
    return stats.isDirectory() // Returns true if directory exists
  } catch {
    return false // Returns false if directory doesn't exist
  }
}

// Function to validate file existence
async function validateFileExists (path) {
  try {
    const stats = await fs.stat(path)
    return stats.isFile() // Returns true if file exists
  } catch {
    return false // Returns false if file doesn't exist
  }
}

const script = {
  name: 'tentant',

  exec: async function (ctx, payload) {
    const sessionId = ctx.session.sessionId
    let [command, arg1] = [...payload]


    ctx.integration.debug('tentants', command, arg1)


    if (command == "add" && arg1 === "automatic")
    {
      await ensureDir(process.cwd() + '/tenants')

      let git = simpleGit({ baseDir: process.cwd() + '/tenants' })
      try
      {
        await git.clone("https://github.com/vladmandic/automatic")
      }
      catch(ex)
      {
        git = simpleGit({ baseDir: process.cwd() + '/tenants/automatic' })
        await git.pull()
      }

      //run the child process
      let child

      if (os.platform() === 'linux' || os.platform() === 'darwin') {
        child = spawn('webui.sh', ['--listen'], {cwd: process.cwd() + '/tenants/automatic'})
      }
      else
      {
        child = spawn('webui.bat', ['--listen'], {cwd: process.cwd() + '/tenants/automatic'})
      }



      child.stdout.on('data', (data) => {

        if (data.toString().includes('Download the default model? (y/N)')) {
          child.stdin.write('Y\n');
        }

        ctx.app.sendMessageToSession(sessionId, data.toString(), 'text/plain')
      });

      child.stderr.on('data', (data) => {
        ctx.app.sendErrorToSession(sessionId, data.toString())
      });

      child.on('exit', function (code, signal) {
        ctx.app.sendMessageToSession(sessionId, 'child process exited with ' +
                    `code ${code} and signal ${signal}`);
      });

    }

    return {
      success: 'ok'
    }
  }

}

export default script
