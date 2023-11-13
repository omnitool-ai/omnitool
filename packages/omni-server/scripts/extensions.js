/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// Import required modules
import { rmSync } from 'fs'
import { ensureDir } from 'fs-extra'
import fs from 'fs/promises'
import yaml from 'js-yaml'
import path from 'path'
import { simpleGit } from 'simple-git'
import { exec } from 'child_process'

const TEMPLATE_EXTENSION_REPO = 'https://github.com/omnitool-ai/omni-extension-template.git'

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

// Function to check if there's a build entry in package.json
async function hasBuildScript(packageJsonPath) {
  try {
    const content = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(content);
    return packageJson.scripts && packageJson.scripts.build;
  } catch (e) {
    return false;
  }
}

async function try_exec_command(command, cwd) {
  let cmd_error = null;

  try
  {
    exec(command, { cwd: cwd }, (error, stdout, stderr) => {
    if (error)
    {
      cmd_error = `Warning: problem while issuing command ${command} at ${cwd} with stdout: ${stdout}\nstderr: ${stderr}\nerror: ${error}`;
    }
    });
  }
  catch (e)
  {
    cmd_error = `Warning: problem while issuing command ${command} at ${cwd} with error message: ${e.message}`;
  }
  if (cmd_error)
  {
    console.warn(cmd_error);
    return false;
  }

  return true;
}

async function getKnownExtensions() {
  const knownFilePath = path.join(process.cwd(), 'config.default', 'extensions', 'known_extensions.yaml')
  const knownFileContents = await fs.readFile(knownFilePath, 'utf8')
  return yaml.load(knownFileContents)
}

// Function to update extensions
const updateExtension = async function (ctx, extensionId) {
  const sessionId = ctx.session.sessionId
  const target = path.join(process.cwd(), '/extensions/', extensionId)

  // Log the target of the update
  ctx.integration.info('Update', extensionId, target)

  // Check if the extension and its directory exist
  if (ctx.app.extensions.has(extensionId) && await validateDirectoryExists(target)) {
    // Check if the required file is present
    if (!await validateFileExists(path.join(target, 'extension.yaml'))) {
      const error = `Failed to update extension:\n${extensionId} appears to not be a valid extension (extension.yaml not found).`
      ctx.app.sendErrorToSession(sessionId, error)
      return { error }
    }
    // Check if .git directory exists
    if (await validateDirectoryExists(path.join(target, '.git'))) {
      await ctx.app.sendMessageToSession(sessionId, `Attempting to update extension: ${extensionId}`, 'text/plain')
      try {
        // Update the git repository
        const git = simpleGit({ baseDir: target })
        const result = await git.pull()

        // Send successful update message
        await ctx.app.sendMessageToSession(sessionId, 'Extension updated (May require a server restart).\n',
          'text/plain',
          {
            objects: [result],
            commands: [
              {
                title: 'Restart Server',
                id: 'rs',
                args: []
              }
            ]

          }
        )
        return true
      } catch (e) {
        // Handle update failure
        const error = `Failed to update extension:\n${e.message}`
        ctx.integration.error(error)
        ctx.app.sendErrorToSession(sessionId, error)
        return { error }
      }
    } else {
      // Handle missing git repository case
      const error = `Failed to update extension: ${extensionId} cannot be updated. (no git repository found at ${target})`
      ctx.integration.error(error)
      ctx.app.sendErrorToSession(sessionId, error)
      return { error }
    }
  } else {
    // Handle invalid/active extension case
    const error = `Failed to update extension:\n${extensionId} appears to not be a valid/active extension.`
    ctx.app.sendErrorToSession(sessionId, error)
    return { error }
  }
}

const script = {
  name: 'extensions',

  exec: async function (ctx, payload) {
    const sessionId = ctx.session.sessionId
    let [command, arg1] = [...payload]

    ctx.integration.debug('extensions', command, arg1)
    if (arg1?.length > 1) {
      if (command === 'manifest') {
        const response = await fetch(arg1)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const text = await response.text()
        const manifest = yaml.safeLoad(text)

        await ctx.app.sendMessageToSession(sessionId, 'Extension Manifest', 'text/plain', {
          objects: [manifest],
          commands: [
            {
              title: 'Install',
              id: 'extensions',
              args: ['add', manifest.origin]
            }
          ]
        })
      } else if (command === 'add') {
        try {
          // if it's not a git repository we need to resolve it.
          if (!arg1.endsWith('.git')) {
            await ctx.app.sendMessageToSession(sessionId, 'Loading extension manifest from: ' + arg1, 'text/plain')
            const response = await fetch(arg1)
            if (!response.ok) {
              ctx.app.sendErrorToSession(sessionId, 'Failed to retrieve manifest' + response.status)
              throw new Error(`HTTP error! status: ${response.status}`)
            }
            const text = await response.text()
            const manifest = yaml.load(text)
            if (manifest.origin !== undefined) {
              arg1 = manifest.origin
            } else {
              ctx.app.sendErrorToSession(sessionId, 'Failed to install extension: No origin found in extension.yaml')
              throw new Error('No origin found in extension.yaml')
            }
            await ctx.app.sendMessageToSession(sessionId, 'Downloaded extension manifest from: ' + arg1, 'text/plain', { objects: [manifest] })
          }
          await ctx.app.sendMessageToSession(sessionId, 'Attempting to install extension from: ' + arg1 + '\nPlease wait...', 'text/plain')

          const git = simpleGit({ baseDir: path.join(process.cwd(),'extensions') })
          await git.clone(arg1)

          await ctx.app.sendMessageToSession(sessionId, 'Extension added, please restart the server.\n', 'text/plain',{
          commands: [
            {
              title: 'Restart Server',
              id: 'rs',
              args: []
            }
          ]}
          );

          await ctx.app.kvStorage?.set('extensions.dirty', true)

          return true;
        } catch (e) {
          const error = 'Failed to install extension:\n' + e.message
          console.log(e.message)
          return { error }
        }
      } else if (command === 'show') {
        const extensionId = arg1.replace(/[^a-zA-Z0-9-_]/g, '')
        if (ctx.app.extensions.has(extensionId)) {
          const extension = ctx.app.extensions.get(extensionId)
          await ctx.app.sendMessageToSession(sessionId, JSON.stringify({ id: extension.id, title: extension.config.title, description: extension.config.description || 'No description.' }, null, 2),
            'text/plain',
            {
              commands:
                [
                  {
                    title: 'Update',
                    id: 'extensions',
                    args: ['update', extensionId]
                  }
                ]
            }
          )
        }
        return true
      } else if (command === 'update') {
        const extensionId = arg1.replace(/[^a-zA-Z0-9-_]/g, '')
        return await updateExtension(ctx, extensionId)
      } else if (command === 'create') {
        const extensionId = arg1.replace(/[^a-zA-Z0-9-_]/g, '')
        const targetPath = path.join(process.cwd(), 'extensions', extensionId)
        if (!(await validateDirectoryExists(targetPath))) {
          await ensureDir(targetPath)

          const git = simpleGit({ baseDir: targetPath })
          await git.clone(TEMPLATE_EXTENSION_REPO, targetPath)
          // Remove git directory to re-init repository to a new one
          rmSync(path.join(targetPath, '.git'), { recursive: true, force: true })
          const result = await git.init()
          await ctx.app.sendMessageToSession(sessionId, `Extension ${extensionId} created at ${targetPath}, please restart server.\n`, 'text/plain', { objects: [result],
            commands: [
              {
                title: 'Restart Server',
                id: 'rs',
                args: []
              }
            ]
          })
          await ctx.app.kvStorage?.set('extensions.dirty', true)
          return true
        } else {
          ctx.app.sendErrorToSession(sessionId, `An extension with the id ${extensionId} already exists.`)
        }
      } else if (command === 'remove') {
        const extensionId = arg1.replace(/[^a-zA-Z0-9-_]/g, '')
        await ctx.app.sendMessageToSession(sessionId, `To remove this extension, please delete the folder ${extensionId} in the server's extension folder and restart the server.`, 'text/plain',
        {
          commands: [
          {
            title: 'Restart Server',
            id: 'rs',
            args: []
          }
        ]
      }

        )
      }
    } else {
      if (command === 'installed') {
        const allExtensions = ctx.app.extensions.all()
        const commands = allExtensions.map(e => ({ id: 'extensions', title: 'Show ' + e.id, args: ['show', e.id] }))
        await ctx.app.sendMessageToSession(sessionId, 'Installed Extensions\n\n' + allExtensions.map(e => `- ${e.id} ${e.config.title}: ${e.config.description || 'No description available'}`).join('\n'),
          'text/plain',
          {
            commands
          })

        return true
      } else if (command === 'list') {
        const knownFile = await getKnownExtensions()
        const commands = knownFile.core_extensions.concat(knownFile.known_extensions).map(function (e) {
          if (ctx.app.extensions.has(e.id)) {
            return {
              id: 'extensions', title: '☑️ ' + e.title, args: ['show', e.id], classes: ['w-32']
            }
          } else {
            return {
              id: 'extensions', title: '📥 ' + e.title, args: ['add', e.url],  classes: ['w-32']
            }
          }
        }
        ).sort((a, b) => a.title.localeCompare(b.title))
        const extensionList = {
          core: knownFile.core_extensions?.map(e => {
            return {type: 'core', installed: `${ctx.app.extensions.has(e.id)}`, id: `${e.id}`, title: `${e.title}`, description: `${e.description}`, url: `${e.url}`};
          }).sort((a, b) => a.title.localeCompare(b.title)),
          premium: knownFile.premium_extensions?.map(e => {
            return {type: 'premium', installed: `${ctx.app.extensions.has(e.id)}`, id: `${e.id}`, title: `${e.title}`, description: `${e.description}`, url: `${e.url}`};
          }).sort((a, b) => a.title.localeCompare(b.title)),
          known: knownFile.known_extensions?.map(e => {
            return {type: 'known', installed: `${ctx.app.extensions.has(e.id)}`, id: `${e.id}`, title: `${e.title}`, description: `${e.description}`, url: `${e.url}`};
          }).sort((a, b) => a.title.localeCompare(b.title)),
          available: knownFile.known_extensions?.filter(e => !e.deprecated).filter(e=>!ctx.app.extensions.has(e.id)).map(e => {
            return {type: 'available', installed: `${ctx.app.extensions.has(e.id)}`, id: `${e.id}`, title: `${e.title}`, description: `${e.description}`, url: `${e.url}`};
          }).sort((a, b) => a.title.localeCompare(b.title)),
        };

        await ctx.app.sendMessageToSession(sessionId, extensionList, 'omni/extension-list', { commands })
        return true
      } else if (command === 'updateAll') {
        const allExtensions = ctx.app.extensions.all()
        for (const extension of allExtensions) {
          try {
            await updateExtension(ctx, extension.id)
          } catch (ex) {
            ctx.integration.error('Failed to update extension: ' + extension.id, ex)
            ctx.app.sendErrorToSession(sessionId, 'Failed to update extension: ' + extension.id + ':' + ex.message)
          }
        }
        return true
      }

      await ctx.app.sendMessageToSession(sessionId, `--- Extension Management ---
        Use to install, manage and remove omnitool extensions.\n\
        Usage:\n/extensions add <git url> - add an extension
        /extensions show <id> - show details on an extension
        /extensions update <id> - update an extension
        /extensions remove <name> - remove an extension
        /extensions create <id> - create a new extension.
        /extensions installed - show installed extensions
        /extensions updateAll - update all installed extensions
        /extensions list - list all known extensions

        ⚠️  WARNING ⚠️
        Extensions are executable code and have the same level access as omnitool itself.
        Only install extensions from trusted sources!
        To safeguard credentials from potentially malicious extensions, especially in a multi-user environment, consider performing an advanced install that sandboxes the key management and REST execution engine a separate machine.`
      ,
      'text/plain',
      {
        commands:
            [
              {
                id: 'extensions',
                title: 'List Available',
                args: ['list'],
                classes: ['w-32']
              },
              {
                id: 'extensions',
                title: 'List Installed',
                args: ['installed'],
                classes: ['w-32']
              },
              {
                id: 'extensions',
                title: 'Update All',
                args: ['updateAll'],
                classes: ['w-32']
              }
            ]
      })

      return true
    }

    return true
  }

}

export default script
