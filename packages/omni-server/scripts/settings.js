/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
    name: 'settings',

    permission: async function (ctx, ability, payload) {
      const auth = ctx.app.integrations.get('auth')
      const isAdmin = await auth.isAdmin(ctx.user)
      if (!isAdmin) {
        await ctx.app.sendMessageToSession(ctx.sessionId, 'Admin permission needed to change server settings', 'text/plain')
        throw new Error('Admin permission needed to change server settings')
      }
    },
  
    exec: async function (ctx, payload) {
      const [command, ...args] = payload
      ctx.integration.debug('script', command, args)
    
      if (command === 'list') {
        const settings = ctx.app.settings.getAll()
        await ctx.app.sendMessageToSession(
            ctx.sessionId, 
            'Server settings:\n\n' + settings.map((setting) => '- ' + setting.key + ': ' + setting.value).join('\n'), 
            'text/plain'
        )
      } else if (command === 'set') {
        const [key, value] = args
        if (!key || !value) {
            await ctx.app.sendMessageToSession(
                ctx.sessionId, 
                'Usage: /settings set <key> <value>', 
                'text/plain'
            )
            return true
        }
        
        await ctx.app.settings.update(key, value)
        await ctx.app.sendMessageToSession(
            ctx.sessionId, 
            'Setting ' + key + ' set to ' + ctx.app.settings.get(key)?.value + '\n Some changes needs a server restart to take effect.', 
            'text/plain'
        )
      } else if (command === 'reset') {
        const [key] = args
        if (!key) {
            await ctx.app.sendMessageToSession(
                ctx.sessionId, 
                'Usage: /settings reset <key>', 
                'text/plain'
            )
            return true
        }
        await ctx.app.settings.reset(key)
        await ctx.app.sendMessageToSession(
            ctx.sessionId, 
            'Setting ' + key + ' reset\n You may need to restart the server for the change to take effect.', 
            'text/plain'
        )
      }

      return true  
    }

  }
  
  export default script
  