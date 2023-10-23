// /* *
//  * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
//  * All rights reserved.
//  */

// /*import yaml from 'js-yaml'
// import { OAIComponent31, WorkflowComponentRegistry } from 'omni-sockets'

// import fs from 'fs/promises'

// const processAPI = async function (ctx, ns, url, filterOpIds, patches) {
//   console.log('Processing API ' + ns + ' ' + url, filterOpIds, patches?.length || 0)
//   let specDoc
//   try {
//     specDoc = await fetch(url)
//   } catch (e) {
//     console.log(e)
//     return []
//   }

//   if (!specDoc) {
//     return { response: 'Error: Could not fetch OpenAPI spec' }
//   }

//   const doc = await yaml.load(await specDoc.text())
//   if (!doc) {
//     return { response: 'Error: Could not load the OpenAPI spec' }
//   }

//   const adapter = new ctx.app.blocks.ReteAdapter(ns, doc)
//   let components = adapter.getReteComponentDefs(filterOpIds)

//   components = components.map(async (c) => {
//     const key = `${c.displayNamespace}.${c.displayOperationId}`
//     // Add to new blocks manager
//     if (!ctx.app.blocks.hasBlock(key)) {
//       try {
//         ctx.app.blocks.addBlock(c)
//       } catch (e) {
//         console.error(e)
//         return null
//       }
//     }
//     console.log('Adding Block: ' + key)
//     const component = ctx.app.blocks.getInstance(`${c.displayNamespace}.${c.displayOperationId}`)

//     if (!patches) { // don't send if we got patches instead
//       await ctx.app.sendMessageToSession(
//         ctx.session.sessionId,
//         JSON.stringify(component.toJSON()),
//         'omni/component'
//       )
//     }
//     return component
//   })

//   if (patches) {
//     for (const patch of patches) {
//       try {
//         ctx.app.blocks.addPatch(patch)
//       } catch (e) {
//         console.error(e)
//       }

//       const component = ctx.app.blocks.getInstance(`${patch.displayNamespace}.${patch.displayOperationId}`)
//       console.log(`Adding patch ${patch.displayNamespace}.${patch.displayOperationId}`, component)
//       await ctx.app.sendMessageToSession(
//         ctx.session.sessionId,
//         JSON.stringify(component.toJSON()),
//         'omni/component'
//       )
//     }
//   } else {
//     console.log(`No patches found for ${ns} ${url}`)
//   }

//   /* let testPatch = {
//     apiNamespace: 'openai',
//     apiOperationId: 'createChatCompletion',
//     displayNamespace: 'openai',
//     displayOperationId: 'simpleChatGPT',
//     title: 'Best ChatGPT Ever',
//     category: 'Text Generation',
//     tags: ['default'],
//     description: "Talk to meee",
//     meta: {
//       source:
//       {
//         summary: "OpenAIs ChatGPT",
//         links: {
//           "blog": 'https://openai.com/blog/openai-api/'
//         }
//       }
//     }
//     //inputs?: Record<string, OmniIO> // Change from array to object
//     //controls?: Record<string, OmniControl> // Change from array to object
//     //outputs?: Record<string, OmniIO> // Change from array to object
//   }

//   if (ns === 'openai' && !ctx.app.blocks.patches.has('openai.simpleChatGPT')) {
//     ctx.app.blocks.addPatch(testPatch)
//   }
//   const component = ctx.app.blocks.getInstance(`${testPatch.displayNamespace}.${testPatch.displayOperationId}`)

//  // console.log(inspect(component.toJSON(), { showHidden: false, depth: null }));

//   ctx.app.sendMessageToSession(
//     ctx.session.sessionId,
//     JSON.stringify(component.toJSON()),
//     'omni/component'
//   ) */

//   WorkflowComponentRegistry.getSingleton().add(components)

//   return components
// }

// const oldIOtoNewIo = function (io, visible) {
//   return {
//     title: io.title,
//     description: io.description,
//     customSocket: io['x-type'],
//     required: io.required,
//     default: io.default,
//     minimum: io.minimum,
//     maximum: io.maximum,
//     choices: io.choices,
//     hidden: io.hidden
//   }
// }

// async function getDirectories (source) {
//   const dirents = await fs.readdir(source, { withFileTypes: true })
//   return dirents
//     .filter(dirent => dirent.isDirectory())
//     .map(dirent => path.join(source, dirent.name))
// }

// async function checkDirectory (path) {
//   try {
//     await fs.access(path)
//     return true
//   } catch {
//     return false
//   }
// }

// const script = {
//   name: 'openapi',

//   exec: async function (ctx, payload) {
//     if (!ctx.app.blocks.factories.has('OAIComponent31')) {
//       // Register factory with new blocks manager
//       ctx.app.blocks.registerType('OAIComponent31', OAIComponent31.fromJSON)
//     }

//     if (payload[0] === 'all') {
//       ctx.app.blocks.blocks.clear()
//       ctx.app.blocks.patches.clear()
//       // traverse through all directories in process.cwd()/etc/registry/
//       const registryDir = process.cwd() + '/etc/registry/'
//       const registry = await fs.readdir(registryDir)
//       // go through each dir and find the first yaml file
//       await Promise.all(registry.map(async (dir) => {
//         const dirPath = registryDir + dir
//         const files = await fs.readdir(dirPath)
//         await Promise.all(files.map(async (file) => {
//           if (file.endsWith('.yaml')) {
//             // load the yaml file
//             const nsData = yaml.load(await fs.readFile(dirPath + '/' + file, 'utf8'))
//             // get the namespace
//             const ns = nsData.namespace
//             const url = nsData.api?.url
//             if (url) {
//               let opIds
//               let patches
//               // get every yaml file in the components subdirectory if it exists
//               const componentsDir = dirPath + '/components'
//               if (await (checkDirectory(componentsDir))) {
//                 opIds = []
//                 patches = []
//                 const components = await fs.readdir(componentsDir)
//                 await Promise.all(components.map(async (component) => {
//                   if (component.endsWith('.yaml')) {
//                     // load the yaml file
//                     console.log('Loading ' + component + ' as ' + ns)
//                     const oldPatch = yaml.load((await fs.readFile(componentsDir + '/' + component, 'utf8')))

//                     if (!oldPatch.from || !oldPatch.create || typeof (oldPatch.from) !== 'string' || typeof (oldPatch.create) !== 'object') {
//                       console.log('Skipping ' + component + ' as it does not have a from/create field', oldPatch)
//                       return null
//                     }

//                     const newPatch =
//                     {
//                       category: oldPatch.patch.category,
//                       tags: oldPatch.patch.tags,
//                       description: oldPatch.patch.description,
//                       meta: oldPatch.patch.meta,
//                       title: oldPatch.patch.title,
//                       apiNamespace: ns,
//                       apiOperationId: oldPatch.from.split('.')[1],
//                       displayNamespace: oldPatch.create.namespace,
//                       displayOperationId: oldPatch.create.componentKey,
//                       macros: {},
//                       controls: oldPatch.patch?.controls
//                     }

//                     // Todo: Convert hideExcept to Macro

//                     if (oldPatch.patch?.inputs?.$hideExcept?.length > 0) {
//                       delete oldPatch.patch.inputs.$hideExcept
//                     }
//                     if (oldPatch.patch?.outputs?.$hideExcept?.length > 0) {
//                       delete oldPatch.patch.outputs.$hideExcept
//                     }

//                     newPatch.inputs = oldPatch.patch?.inputs ? Object.fromEntries(Object.entries(oldPatch.patch.inputs).map(([key, value]) => [key, oldIOtoNewIo(value)])) : []
//                     newPatch.outputs = oldPatch.patch?.outputs ? Object.fromEntries(Object.entries(oldPatch.patch.outputs).map(([key, value]) => [key, oldIOtoNewIo(value)])) : []

//                     opIds.push(newPatch.apiOperationId)
//                     patches.push(newPatch)
//                     console.log('Patch Added ' + newPatch.displayNamespace + '.' + newPatch.displayOperationId)
//                   }
//                 }))
//               }

//               console.log('Loading ' + url + ' as ' + ns)
//               if (!patches?.length) {
//                 console.log('No patches found for ' + ns + ' ' + url)
//                 return []
//               }
//               try {
//                 const result = await processAPI(ctx, ns, url, opIds, patches)
//                 return result
//               } catch (e) {
//                 console.error(e)
//                 return null
//               }
//             } else {
//               return null
//             }
//           }
//         }))
//       }))

//       return { response: 'Loaded all aps' }
//     } else if (payload.length === 0 || payload.length === 2) {
//       const url = payload[0] || 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml'
//       const ns = payload[1] || 'openai'

//       const components = await processAPI(ctx, ns, url)

//       return { response: `Loaded ${components.length} components` }
//     } else {
//       if (payload.length === 1) {
//         await ctx.app.sendMessageToSession(
//           ctx.session.sessionId,
//           JSON.stringify({ response: 'Usage: /open <url> <namespace_id>' }),
//           'text/plain'
//         )
//         return { response: 'Error: Must specify namespace' }
//       }
//     }
//   }
// }

// export default script
export default {}