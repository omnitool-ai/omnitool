/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
  name: 'blockManager',

  exec: async function (ctx, payload) {
    if (payload.command === 'getInstances')
    {
      let args = payload.args
      if (ctx && ctx.userId) {
        args[1] = ctx.userId; // Override userId from client with actual userId
      }
      let failBehavior = args[2]
    
      const fn = ctx.app.blocks[payload.command].bind(ctx.app.blocks)
      let result = (await fn(...args))
      let blocks = result.blocks
      let missing = result.missing

      if (missing.length > 0)
      {
        let fixed = []
     
        try
        {
            fixed = await Promise.all(missing.map(async (key) =>{
              try
              {
                return ctx.app.blocks.tryResolveExtensionBlock(ctx,key)      
        
              }
              catch (ex)
              {
                console.warn("Could not mitigate missing block", key, ex)

              }
              return undefined
            } 
          ))
        }
        catch(ex)
        {
          console.warn("Error trying to autofix block", ex)
        }

        if (fixed.length > 0)
        {



          fixed = fixed.filter( e=>e)
          
          // If we actually fixed blocks, replace them in the results here.
          if (fixed.length > 0 )
          {

            try
            {
              if (failBehavior === "missing_block")
              {

                
                await Promise.all(fixed.map(async (f)=>
                  {
       
                    let idx = blocks.findIndex( b=>b.data._missingKey === f.name )
                    if (idx != -1)
                    { 
                      blocks[idx] = f
                    }
                  }
                ))
               
              }
              else if (failBehavior === "filter")
              {
                blocks = blocks.concat(fixed)
              }
            }
            catch (ex)
            {
              console.error("Error trying to autofix blocks", ex)
            }
          }
          await ctx.app.sendToastToUser(ctx.userId, {
            message: `Blocks Auto Installed successfully.`,
            options: { type: 'info', description: fixed.map(f=>f.title||f.name).join(', ') }
          });  
        }

   

      }

      return blocks.map( e=>e?.toJSON())
    }

  }


}
export default script
