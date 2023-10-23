/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
  name: 'setKey',

  exec: async function (ctx, payload) {
    const [apiNamespace, tokenType, secret] = payload
    const credentialService = ctx.app.services.get('credentials')
    const response = await credentialService.setUserCredential(ctx.user, apiNamespace, tokenType, secret)
    return { answer: response }
  }

}

export default script
