/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Get Recipes
// --------------------------------------------------------------------------

import fs from 'fs/promises'
import extra from 'fs-extra'
import path from 'path'

import {
    OAIBaseComponent,
    OmniComponentFlags,
    OmniComponentMacroTypes,
    type WorkerContext,
    BlockCategory as Category
  } from 'omni-sockets';
import { type CdnResource,   EOmniFileTypes} from 'integrations/CdnIntegrations/CdnIntegration';
  
  const NS_OMNI = 'omnitool';
  
  const component = OAIBaseComponent.create(NS_OMNI, 'files_from_local_directory')
    .fromScratch()
    .set('title', 'Read Files from Directory')
    .set('category', Category.INPUT_OUTPUT)
    .set(
      'description',
      `Feeds files from the server's data.local/file-import/<user_id> directory to the recipe  
       **Filter**: A regular expression to filter file-names.
       **Recursive**: Include files from all subdirectries recursively.
      `    
    )
    .setMethod('X-CUSTOM');    
  
  component
  
    .addControl(component.createControl('filter', 'string').set('title',"Filter").toOmniControl())    
    .addControl(component.createControl('recursive', 'boolean').set('title',"Recursive").toOmniControl())    

    
    .addOutput(component.createOutput('images', 'object', 'images', {array: true}).set('title', 'Images').toOmniIO())
    .addOutput(component.createOutput('videos', 'object', 'video', {array: true}).set('title', 'Videos').toOmniIO())
    .addOutput(component.createOutput('audios', 'object', 'audio', {array: true}).set('title', 'Audios').toOmniIO())
    .addOutput(component.createOutput('documents', 'object', 'document', {array: true}).set('title', 'Documents').toOmniIO())
    .addOutput(component.createOutput('jsons', 'object', 'json', {array: true}).set('title', 'Objects').toOmniIO())
    .addOutput(component.createOutput('files', 'object', 'file', {array: true}).set('title', 'Files').toOmniIO())
    .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {

        //const dir = path.join(process.cwd(), 'data.local', 'file-import', ctx.userId)
        const fileImportPath = ctx.app.config.settings.paths?.fileImportPath || 'data.local/file-import';
        const dir = path.join(process.cwd(),fileImportPath, ctx.userId)

        await extra.ensureDir(dir)        
        let files = (await fs.readdir(dir, { recursive: !!payload.recursive,  withFileTypes: true  }))
        files = files.filter(f=>f.isFile())
        if (payload.filter)
        {
            files = files.filter(f=>{
                const fname = path.join(f.path.split('file-import')[1], f.name)
                return  fname.match(payload.filter)
            })
        }
        
        const outFiles =  await Promise.all(files.map((f) => ctx.app.cdn.importLocalFile(path.join(f.path, f.name), ['local-import'], ctx.userId)))

        const  images = outFiles.filter((f) => (f as CdnResource).fileType ===   EOmniFileTypes.image)
        const  documents = outFiles.filter((f) => (f as CdnResource).fileType ===   EOmniFileTypes.document).filter((f) => (f as CdnResource).mimeType !== 'application/json')
        const  videos = outFiles.filter((f) => (f as CdnResource).fileType ===   EOmniFileTypes.video)
        const  audios = outFiles.filter((f) => (f as CdnResource).fileType ===   EOmniFileTypes.audio)
        
        let jsons = outFiles.filter((f) => (f as CdnResource).mimeType === 'application/json')

        jsons = await Promise.all(jsons.map(async (f:CdnResource) => ctx.app.cdn.get({fid: f.fid, userId: ctx.userId}, {}, 'object')))

        return {files: outFiles , images, videos, audios, documents, jsons}
      
    });
  
  export const GetFilesFromDirectoryComponent = component.toJSON();

  export default GetFilesFromDirectoryComponent
  