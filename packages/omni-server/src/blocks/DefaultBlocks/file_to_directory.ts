/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Get Recipes
// --------------------------------------------------------------------------

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
  
  const component = OAIBaseComponent.create(NS_OMNI, 'files_to_local_directory')
    .fromScratch()
    .set('title', 'Write Files To Directory')
    .set('category', Category.INPUT_OUTPUT)
    .set(
      'description',
      `Writes files to the server's data.local/file-export/<userID>/<jobId> directory.  
       **Overwrite**: Overwrite existing files.  
       Returns the target directory as well as the list of files written.
       `    
    )
    .setMethod('X-CUSTOM');    
  
  component
    .addControl(component.createControl('overwrite', 'boolean').set('title',"Overwrite").toOmniControl())  
    .addInput(
      component
        .createInput('files', 'object', 'file', { array: true })
        .set('title', 'Files')
        .set('description', 'The files to write in the Directory.')
        .allowMultiple(true)
        .toOmniIO()
    )
    .addOutput(component.createOutput('directory', 'string', 'text').set('title', 'Directory').toOmniIO())
    .addOutput(component.createOutput('files', 'string', 'text', {array: true}).set('title', 'Files').toOmniIO())
    .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {

        //const dir = path.join(process.cwd(), 'data.local', 'file-export', ctx.userId, ctx.jobId)
        const fileExportPath = ctx.app.config.settings.paths?.fileExportPath || 'data.local/file-export';
        const dir = path.join(process.cwd(), fileExportPath, ctx.userId, ctx.jobId)

        await extra.ensureDir(dir)        

        await Promise.all(payload.files.map(async (f:any)=>{
          ctx.app.cdn.exportFile(f.fid, dir, f.fileName, {overwrite: payload.overwrite})
        }))

        return {
          directory: dir,
          files: payload.files.map((f:CdnResource)=>f.fileName)
        }

    })
  
  export const WriteFilesToDirectoryComponent = component.toJSON();

  export default WriteFilesToDirectoryComponent
  