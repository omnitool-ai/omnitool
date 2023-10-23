/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
  name: 'revokeKey',

  exec: async function (ctx, payload) {
    const apiNamespace = payload['0']
    const tokenType = payload['1']

    const credentialService = ctx.app.services.get('credentials')
    const response = await credentialService.revokeUserCredentials(ctx.user, apiNamespace, tokenType)
    return { answer: response }
  }

}

export default script
