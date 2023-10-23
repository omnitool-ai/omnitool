/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Chat Output
// --------------------------------------------------------------------------

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'write_document')
  .fromScratch()
  .set('title', 'Text Document Writer')
  .set('category', Category.FILE_OPERATIONS)
  .set(
    'description',
    'Create and save a text document to the file manager. With the flexibility to specify the file name, format, and storage duration, it streamlines the process of managing text documents within your recipe. The format of the text can be chosen between plain text and markdown. Additionally, you can decide whether to store the document temporarily or permanently.'
  )
  .setMethod('X-CUSTOM');

component.addInput(
  component
    .createInput('text', 'string', 'text', { array: true })
    .set('title', 'Text')
    .set('description', 'A simple input string')
    .allowMultiple(true)
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

  .addControl(
    component
      .createControl('textType', 'string')
      .set('title', 'Format')
      .set('description', 'The format of chat message')
      .setChoices(['text/plain', 'text/markdown'], 'text/markdown')
      .toOmniControl()
  )

  .addControl(
    component
      .createControl('storageType', 'string')
      .set('title', 'Storage Duration')
      .set('description', 'The duration of storage')
      .setChoices(['Temporary', 'Permanent'], 'Permanent')
      .toOmniControl()
  )

  .addOutput(
    component
      .createOutput('document', 'object', 'document')
      .set('title', 'Document')
      .set('description', 'The final document')
      .toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    const type: string = payload.storageType === 'Permanent' ? 'put' : 'putTemp';

    if (Array.isArray(payload.text)) {
      payload.text = payload.text.join('\n');
    }

    let fileName = payload.fileName?.trim?.() || undefined;

    let document;
    if (payload.text?.trim().length > 0) {
      fileName = (fileName || payload.text || 'file')
        .trim()
        .substr(0, 20)
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_');
      let ext = '.md';
      if (payload.textType === 'text/plain') {
        ext = '.txt';
      }
      document = await ctx.app.cdn[type](payload.text, {
        mimeType: payload.textType,
        fileName: fileName + ext,
        userId: ctx.userId,
        jobId: ctx.jobId,
        fileType: 'document'
      });
    }

    return { document };
  });

const TextDocumentWriterComponent = component.toJSON();

export default TextDocumentWriterComponent;
