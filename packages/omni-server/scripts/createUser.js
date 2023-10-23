/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { EObjectAction, User } from 'omni-shared'

const script = {
  name: 'createUser',

  permission: async function (ctx, ability, payload) {
    if (!ability.can(EObjectAction.CREATE, User.modelName)) {
      throw new Error('Insufficient permission: ' + EObjectAction.CREATE + ' ' + User.modelName)
    }
  },

  exec: async function (ctx, payload) {
    ctx.integration.debug('script', payload['0'], payload['1'])
    const authIntegration = ctx.app.integrations.get('auth')
    const [username, password] = payload.map((item) => item.trim())
    const response = await authIntegration.handleRegister(username, password)
    return { answer: response }
  }

}

export default script
