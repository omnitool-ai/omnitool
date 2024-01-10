/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */


const script = {
    name: 'generateJwtToken',
  
    exec: async function (ctx, payload) {
        // const ability = new PermissionChecker(ctx.session.get('permission'))
        // if (!ability) {
        //   throw new Error('Action not permitted')
        // }
        // // Scope will be either:
        // // 1. Execute a workflow
        // // 2. Adding user to an org

        // for (const scope of scopes) {
        //   const { action, subject, orgId, workflowIds } = scope

        //   // Requested scope should match the user's permission
        //   if (!ability.can(action, subject)) {
        //     integration.debug('Action not permitted: ', action, subject)
        //     throw new Error('Action not permitted')
        //   }
        // }
      const [action, subject, expiresIn, ...id] = payload
      let conditions
      if (id) {
        if (Array.isArray(id)) {
          conditions = {
            id: {
              $in: id
            }
          }
        } else {
          conditions = {
            id
          }
        }
      }
      const scopes = [
        {
            action,
            subject,
            conditions
        }
      ]

      // @ts-ignore
      const user = ctx.user
      const sessionId = ctx.session.sessionId
      const integration = ctx.app.integrations.get('auth')
      const token = await integration.generateJwtToken(scopes, user, parseInt(expiresIn))
      ctx.app.sendMessageToSession(sessionId, `Generated token: ${token}`, 'text/plain')
      return true
    }
  
  }
  
  export default script
  