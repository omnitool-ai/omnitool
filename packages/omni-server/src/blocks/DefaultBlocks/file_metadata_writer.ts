/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Chat Output
// --------------------------------------------------------------------------

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'file_metadata_writer')
  .fromScratch()
  .set('title', 'Set File Metadata')
  .set('category', Category.FILE_OPERATIONS)
  .set(
    'description',
    'Assign metadata to a specific file. It enables you to set the file name and other metadata for image, audio, or document files'
  )
  .setMethod('X-CUSTOM');

component.addInput(
  component
    .createInput('file', 'object', 'file', { customSettings: { do_no_return_data: true } })
    .set('title', 'File')
    .set('description', 'A single image, audio or document file')
    .toOmniIO()
);

component
  .addInput(
    component
      .createInput('fileName', 'string', 'text')
      .set('title', 'File Name')
      .set(
        'description',
        'The filename (without extension) to use when saving. If not provided, a default will be used'
      )
      .toOmniIO()
  )

  .addOutput(
    component.createOutput('file', 'object', 'file').set('title', 'File').set('description', 'The file').toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    const fileName = payload.fileName?.trim?.() || undefined;
    const file = payload.file;

    if (payload.fileName && file.fid) {
      file.fileName = fileName;
      await ctx.app.cdn.updateFileEntry(file);
    }

    return { file };
  });

const FileMetaDataWriterComponent = component.toJSON();

export default FileMetaDataWriterComponent;
