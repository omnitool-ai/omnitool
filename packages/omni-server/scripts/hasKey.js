/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { User } from 'omni-shared'

const script = {
    name: 'hasKey',
  
    exec: async function (ctx, payload) {
  
      const credentialService = ctx.app.services.get('credentials')
      const keyList = await credentialService.listKeyMetadata(ctx.userId, User.modelName)
      return keyList?.length > 0
    }
  }
  
  export default script
  