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
    .addInput(
      component
        .createInput('output_dir', 'string', 'text')
        .set('title', 'Optional Directory')
        .set('description', 'If provided, save the files in this Directory.')
        .toOmniIO()
    )
    .addOutput(component.createOutput('directory', 'string', 'text').set('title', 'Directory').toOmniIO())
    .addOutput(component.createOutput('files', 'string', 'text', {array: true}).set('title', 'Files').toOmniIO())
    .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {

        //const dir = path.join(process.cwd(), 'data.local', 'file-export', ctx.userId, ctx.jobId)
        const fileExportPath = ctx.app.config.settings.paths?.fileExportPath || 'data.local/file-export';
        let output_dir = payload.output_dir;
        if (output_dir) {output_dir = path.join(process.cwd(), fileExportPath, ctx.userId,output_dir)}
        const dir = output_dir || path.join(process.cwd(), fileExportPath, ctx.userId, ctx.jobId)
        
        await extra.ensureDir(dir)        

        const files = [];
        for (const f of payload.files)
        {

          let file_name = f.fileName;
          if (payload.overwrite === false) 
          {
            let counter = 1;
            while (await extra.pathExists(path.join(dir, file_name))) 
            {
              const ext = path.extname(file_name);
              const base = path.basename(file_name, ext);
              file_name = `${base}(${counter})${ext}`;
              counter++;
            }
          }
          await ctx.app.cdn.exportFile(f.fid, dir, file_name, {overwrite: payload.overwrite})
          files.push(file_name);
        }

        //@ts-ignore
        //const files = payload.files.map((f:CdnResource)=>f.fileName);

        return {
          directory: dir,
          files
        }

    })
  
  export const WriteFilesToDirectoryComponent = component.toJSON();

  export default WriteFilesToDirectoryComponent
  