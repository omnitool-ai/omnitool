/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Chat Output
// --------------------------------------------------------------------------

import { EOmniFileTypes } from 'omni-sdk';
import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'file_output')
  .fromScratch()
  .set('title', 'File Output')
  .set('category', Category.FILE_OPERATIONS)
  .set(
    'description',
    'Saves recipe results to the File Manager Storage (CTRL+SHIFT+F) for future retrieval. Supports saving text, images, audio, documents, and JSON objects. Choose storage duration and specify file name.'
  )
  .setMethod('X-CUSTOM');

component.addInput(
  component
    .createInput('text', 'string', 'text')
    .set('title', 'Text')
    .set('description', 'A simple input string')
    .toOmniIO()
);

component
  .addInput(
    component
      .createInput('fileName', 'string', 'text')
      .set('title', 'FileName')
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
      .setChoices(['text/plain', 'text/markdown', 'text/html', 'application/json' ], 'text/markdown')
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

  .addInput(
    component
      .createInput('images', 'array', 'imageArray')
      .set('title', 'Images')
      .set('description', 'One or more images')
      .allowMultiple(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('audio', 'array', 'audioArray')
      .set('title', 'Audio')
      .set('description', 'One or more audio files')
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('videos', 'array', 'video', {array: true})
      .set('title', 'Video')
      .set('description', 'One or more video files')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('documents', 'array', 'documentArray')
      .set('title', 'Documents')
      .set('description', 'One or more documents')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('object', 'array', 'objectArray')
      .set('title', 'JSON')
      .set('description', 'A JSON object')
      .toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    const type: string = payload.storageType === 'Permanent' ? 'put' : 'putTemp';

    const fileName = payload.fileName?.trim?.() || undefined;

    if (payload.text?.trim().length > 0) {
      let ext = '.md';
      if (payload.textType === 'text/plain') {
        ext = '.txt';
      }
      if (payload.textType === 'text/html') {
        ext = '.html';
      }
      if (payload.textType === 'application/json') {
        ext = '.json';
      }


      await ctx.app.cdn[type](payload.text, {
        mimeType: payload.textType,
        fileName: fileName + ext,
        fileType: EOmniFileTypes.document,
        userId: ctx.userId
      });
    }

    if (payload.images) {
      await Promise.all(
        payload.images.forEach((image: any) => {
          ctx.app.cdn[type](
            image,
            { mimeType: image.mimeType, fileName: fileName || image.fileName, userId: ctx.userId, jobId: ctx.jobId },
            image.meta
          );
        })
      );
    }

    if (payload.documents) {
      await Promise.all(
        payload.documents.forEach((doc: any) => {
          ctx.app.cdn[type](
            doc,
            { mimeType: doc.mimeType, fileName: fileName || doc.fileName, userId: ctx.userId, jobId: ctx.jobId },
            doc.meta
          );
        })
      );
    }

    if (payload.audio) {
      await Promise.all(
        payload.audio.forEach((audio: any) => {
          ctx.app.cdn[type](
            audio,
            { mimeType: audio.mimeType, fileName: fileName || audio.fileName, userId: ctx.userId, jobId: ctx.jobId },
            audio.meta
          );
        })
      );
    }

    if (payload.videos) {
      await Promise.all(
        payload.videos.forEach((video: any) => {
          ctx.app.cdn[type](
            video,
            { mimeType: video.mimeType, fileName: fileName || video.fileName, userId: ctx.userId, jobId: ctx.jobId },
            video.meta
          );
        })
      );
    }


    return {};
  });

const FileOutputComponent = component.toJSON();

export default FileOutputComponent;
