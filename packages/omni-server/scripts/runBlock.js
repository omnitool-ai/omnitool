/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
  name: 'runBlock',

  exec: async function (ctx, payload) {
    const blockManager = ctx.app.blocks

    const block = payload.block
    const args = payload.args
    const opts = {}

    if (payload.cache) {
      opts.cacheType = payload.cache
    }
    if (payload.bustCache) {
      opts.bustCache = payload.bustCache
    }
    if (payload.timeout) {
      opts.timeout = payload.timeout
    }

    // TypeScript can't check types in plain JavaScript
    // runScript gives a `ctx` of type IRunScriptContext
    // runBlock takes a `ctx` of type WorkerContext
    const workerContext = { ...ctx } // Shallow copy
    const jobData = {
      session: null, // ctx.session,
      sessionId: ctx.sessionId,
      user: null, // ctx.user,
      userId: ctx.userId,
      jobId: ctx.jobId,
      workflowId: ctx.workflowId,
      args
    }
    workerContext.getData = () => { return jobData }
    const result = await blockManager.runBlock(workerContext, block, args, {}, opts)

    return result
  }
}

export default script
