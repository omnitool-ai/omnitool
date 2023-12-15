/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
    name: 'workflow',
  
    exec: async function (ctx, payload) {
        const [command, ...args] = payload
        ctx.integration.debug('script', command, args)

        if (command === 'import') {
            const [ fid ] = args

            if (!fid) {
                await ctx.app.sendMessageToSession(
                    ctx.sessionId, 
                    'Usage: /workflow import <fid>', 
                    'text/plain'
                )
                return true
            }

            console.debug('importing workflow from fid', fid)

            const result = await ctx.app.integrations.get('workflow').importWorkflow(ctx.userId, fid)
            return result
        }
    }
  
  }
  
  export default script
  