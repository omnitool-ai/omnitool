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
      .setDefault('file')
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
      .createInput('images', 'array', 'imageArray', {array: true})
      .set('title', 'Images')
      .set('description', 'One or more images')
      .allowMultiple(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('audio', 'array', 'audioArray', {array: true})
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
      .createInput('documents', 'array', 'documentArray', {array: true})
      .set('title', 'Documents')
      .set('description', 'One or more documents')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('objects', 'array', 'objectArray', {array: true})
      .set('title', 'JSON')
      .set('description', 'A JSON object')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('unique', 'boolean', 'boolean')
      .set('title', 'Unique Names')
      .set('description', 'If true, will avoid creating files with the same name by adding _2, _3 etc. to the end of the file names')
      .toOmniIO()
  )
  .addOutput(
    component.createOutput('files', 'array', 'fileArray').set('title', 'Files').set('description', 'The file(s)').toOmniIO()
  )
  .addOutput(
    component.createOutput('urls', 'string', 'text').set('title', 'URLs').set('description', 'The URLs to download the created file(s)').toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    
    const permanence: string = payload.storageType === 'Permanent' ? 'put' : 'putTemp';
    const unique: boolean = payload.unique || false;

    const fileName = payload.fileName?.trim?.() || undefined;
    const files = [];

    if (payload.text?.trim().length > 0) 
    {
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

      const file = await ctx.app.cdn[permanence](payload.text, {
        mimeType: payload.textType,
        fileName: fileName + ext,
        fileType: EOmniFileTypes.document,
        userId: ctx.userId
      });
      files.push(file);
    }
    
    if (payload.objects)
    {
      let json_string = "";
      if (payload.objects.length === 1) json_string = JSON.stringify(payload.objects[0]);
      else json_string = JSON.stringify({ "json": payload.objects });

      const file = await ctx.app.cdn[permanence](json_string, {
        mimeType: 'application/json',
        fileName: fileName + ".json",
        fileType: EOmniFileTypes.document,
        userId: ctx.userId
      });
      files.push(file);
    } 

    if (payload.documents) await uploadAndAddFiles(payload.documents, permanence, fileName, ctx, files, unique);
    if (payload.images) await uploadAndAddFiles(payload.images, permanence, fileName, ctx, files, unique);
    if (payload.audio) await uploadAndAddFiles(payload.audio, permanence, fileName, ctx, files, unique);
    if (payload.videos) await uploadAndAddFiles(payload.videos, permanence, fileName, ctx, files, unique);
    
    const urls = [];
    if (!files || files.length === 0) return {"ok":false};

      for (const file of files) 
      {
        const name = file.fileName;
        const fid = file.fid;

        const raw_url = "http://"+file.ticket.publicUrl + file.url+"?download=true";
        const url = `<a href="${raw_url}" target="_blank">${name} --> ${fid}</a>\n  `;

        urls.push(url);
      }
   
    const result = {"ok":true, files, urls};
    return result;
  });

const FileOutputComponent = component.toJSON();

export default FileOutputComponent;

async function uploadAndAddFiles(items: any[], type: string, fileName: string, ctx: any, files: any[], unique: boolean) 
{
  let index = 0;
  for (const cdnRecord of items) 
  {

    //const entry = await ctx.app.cdn.get(cdnRecord.ticket);
    const buffer = cdnRecord.data;
    const data = Buffer.from(buffer);//, 'base64');
    const ext = cdnRecord.fileName.split('.').pop();
    let new_filename = fileName || cdnRecord.fileName;
    if (unique && files.length > 0) new_filename = new_filename + '_' + (index+1);
    if (ext) new_filename = new_filename + '.' + ext;

    const file = await ctx.app.cdn[type](
      data,
      { mimeType: cdnRecord.mimeType, fileName: new_filename, userId: ctx.userId, jobId: ctx.jobId },
      cdnRecord.meta);

    files.push(file);
    index++;
  }
}
