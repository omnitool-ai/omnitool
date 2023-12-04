/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { User } from 'omni-shared'

const script = {
    name: 'getFilesForJob',
  
    exec: async function (ctx, payload) {


      const cdn = ctx.app.cdn

      const { jobId } = payload

      const files = cdn.getAllForJobId(jobId, ctx.userId)

      return {files}
  
    }
  }
  
  export default script
  