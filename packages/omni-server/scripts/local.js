import fs from 'fs-extra'
import path from 'path'
import yaml from 'js-yaml'


const isValidUrl= function (str) {
  let url;

  try {
    url = new URL(str);
  } catch (e) {
    return false;
  }

  return url.protocol === 'http:' || url.protocol === 'https:';
}


const script = {
  name: 'local',

  permission: async function (ctx, ability, payload) {
    const auth = ctx.app.integrations.get('auth')
    const isAdmin = await auth.isAdmin(ctx.user)
    if (!isAdmin) {
      await ctx.app.sendMessageToSession(ctx.sessionId, 'Admin permission needed to change server settings', 'text/plain')
      throw new Error('Admin permission needed to change server settings')
    }
  },

  exec: async function (ctx, payload) {
    let [command, template, baseUrl] = [...payload]
    const sessionId = ctx.session.sessionId || ctx.sessionId
    console.log(command, template, baseUrl)
    if (['add', 'del', 'templates'].indexOf(command) === -1) {
      return { message: 'Invalid command' }
    }


    if (command === 'templates') {
      const sourceDir = path.join(process.cwd(), 'extensions', 'omni-core-blocks', 'server', 'templates')
      const destDir = path.join(process.cwd(), 'data.local', 'apis-local')

      // Read directories from source path
      const templates = await fs.readdir(sourceDir)
      const msg = []
      const commands = []
      for (const temp of templates) {
        const installed = fs.existsSync(path.join(destDir, temp))
        msg.push(`- ${temp} ${installed ? " (installed)" : "(not installed)"}`)
        commands.push( { title: (!installed ? "Install " : "Uninstall ")+ temp, id: 'local', args: [ (!installed ?'add':"del"), temp] })
      }
      console.log('Known Templates: ' + msg.join('\n'))
      await ctx.app.sendMessageToSession(sessionId, 'Known Templates:\n ' + msg.join('\n'), 'text/plain',{commands}
      )
      return true;
    }


    if (!template)
    {
      return { message: 'Template name not specified' }
    }

    // Sanitize template
    template = template.replace(/[^a-zA-Z0-9_-]/g, '')

    if (template.length < 2) {
      throw new Error('Template name too short after sanitization')
    }


    const sourceDir = path.join(process.cwd(), 'extensions', 'omni-core-blocks', 'server', 'templates', template)
    const destDir = path.join(process.cwd(), 'data.local', 'apis-local', template)

    if (command === 'add') {
      // Check if the directory exists and destination directory does not exist
      if (fs.existsSync(sourceDir) && !fs.existsSync(destDir)) {
        // Copy the directory recursively
        await fs.copy(sourceDir, destDir)

        const yamlFile = path.join(destDir, `${template}.yaml`)
        let content = await fs.readFile(yamlFile, 'utf8')
        const yamlContent = yaml.load(content)
        console.log(yamlContent)
        if (!isValidUrl(baseUrl)) {
          baseUrl = yamlContent.api.defaultPath ?? 'http://localhost:7860'
        }
        // Replace $BASE_URL in yaml file if baseUrl is valid
        if (baseUrl) {
          content = content.replace(/\$BASE_URL/g, baseUrl)
          await fs.writeFile(yamlFile, content, 'utf8')

        }
      } else if (fs.existsSync(destDir)) {

        await ctx.app.sendToastToUser(ctx.userId, {
          message: `Failed to add` + template,
          options: { type: 'danger', description: template + ' is already instealled, remove first.'  }
        });

        throw new Error(`Template ${template} already installed, uninstall first.`)
      } else {

        await ctx.app.sendToastToUser(ctx.userId, {
          message: `Failed to add` + template,
          options: { type: 'danger', description: `Template with name ${template} does not exist.`  }
        });

        throw new Error('Template directory does not exist')
      }

      await ctx.app.blocks.registerFromFolder(destDir, 'local', true)

    } else if (command === 'del') {
      // Remove the directory recursively if it exists
      if (fs.existsSync(destDir)) {
        await fs.remove(destDir)
        await ctx.app.blocks.uninstallNamespace(template, 'local')
      } else {
        await ctx.app.sendToastToUser(ctx.userId, {
          message: `Failed to remove ${template}` ,
          options: { type: 'danger', description: `Template with name ${template} is not installed.`  }
        });


        throw new Error('Destination directory does not exist')
      }
      await ctx.app.sendToastToUser(ctx.userId, {
        message: `Uninstalled ${template}`,
        options: { type: 'success', description: `${template} has been uninstalled and all it's blocks have been removed from Omnitool.`  }
      });
      return {ok: true}

    }

    await ctx.app.sendToastToUser(ctx.userId, {
      message: `Installed ${template} (${baseUrl})`,
      options: { type: 'success', description: `${template} has been installed and it's blocks are now available in the block manager.`  }
    });

    return { message: 'done' }
  }
}

export default script
