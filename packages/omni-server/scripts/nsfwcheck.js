/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */



const script = {
    name: 'nsfwcheck',
  
    exec: async function (ctx, payload) {
      
      const nsfwCheck = ctx.app.nsfwCheck

      const fid = Array.isArray(payload) ? payload[0] : payload.fid
      
      if (fid)
      {
        console.log(fid)
        const obj = await  ctx.app.cdn.get({fid})
        const buffer = Buffer.from(obj.data)

        const result = await nsfwCheck(buffer, {maxDimensions: 0})

        ctx.app.sendMessageToSession(ctx.session.sessionId, JSON.stringify(result.classes), 'text/plain')
        return true
      }
    }
  
  }

  export default script
  