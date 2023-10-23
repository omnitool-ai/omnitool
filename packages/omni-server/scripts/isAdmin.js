/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
  name: 'isAdmin',

  exec: async function (ctx, payload) {
    const user = ctx.user
    ctx.integration.debug("user", user)
    const auth = ctx.app.integrations.get('auth')
    const isAdmin = await auth.isAdmin(ctx.user)
    ctx.app.sendMessageToSession(ctx.session.sessionId, `User is ${isAdmin ? '' : 'not'} admin`, 'text/plain')
    return true
  }

}

export default script
