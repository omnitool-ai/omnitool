/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets'

const NS_OMNI = 'omnitool'

const component = OAIBaseComponent.create(NS_OMNI, 'input_static_file')

component
  .fromScratch()
  .set('description', 'Link a static asset from the file manager')
  .set('title', 'Static File Asset')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-CUSTOM')

component

  .addInput(
    component.createInput('fid', 'string')
      .set('title', 'File')
      .set('description', 'The File Asset')
      .setRequired(true)
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )

  .addControl(
    component.createControl('preview')
      .setControlType('AlpineLabelComponent')
      .set('displays', 'input:fid')
      .toOmniControl()
  )

  .addOutput(
    component.createOutput('file', 'object', 'file')
      .set('title', 'File')
      .set('description', 'The File Object')
      .toOmniIO()
  )

  .addOutput(
    component.createOutput('url', 'string')
      .set('description', 'The url of the file file')
      .toOmniIO())


  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    try {
      if (!payload.fid) {
        return {}; // do not trigger error when no image is provided
      }
      const  file  = await ctx.app.cdn.find(payload.fid, ctx.userId);

      if (!file)
      {
        throw  new Error("File with id " + payload.fid + " could not be found.")
      }

      return { file, url: file.url };

    } catch (error) {
      console.error(error);
      throw error;
    }
  });

const StaticFileComponent = component.toJSON()
export default StaticFileComponent
