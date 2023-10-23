/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Chat Output
// --------------------------------------------------------------------------

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category} from 'omni-sockets';
import { type ICdnResource, EOmniFileTypes, OmniBaseResource } from 'omni-sdk';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'chat_output')
  .fromScratch()
  .set('title', 'Chat Output')
  .set('category', Category.INPUT_OUTPUT)
  .set(
    'description',
    "Send data from this block's inputs to the chat window. The chat supports text formats like text/plain, text/markdown, and text/markdown-code. Images, Audio, Documents, and Video are automatically embedded as interactive elements. Users can select either permanent or expiring storage modes for files."
  )
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('text', 'string', 'text', { array: true })
      .set('title', 'Text')
      .set('description', 'A simple input string')
      .allowMultiple(true)
      .toOmniIO()
  )

  .addControl(
    component
      .createControl('textType', 'string')
      .set('title', 'Message Format')
      .set('description', 'The format of chat message')
      .setChoices(['text/plain', 'text/markdown', 'text/markdown-code'], 'text/markdown')
      .toOmniControl()
  )

  .addInput(
    component
      .createInput('images', 'array', 'image', { array: true } )
      .set('title', 'Images')

      .set('description', 'One or more images')
      .allowMultiple(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('audio', 'array', 'audio', { array: true })
      .set('title', 'Audio')
      .set('description', 'One or more audio files')

      .allowMultiple(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('documents', 'array', 'document', { array: true })
      .set('title', 'Documents')
      .set('description', 'One or more documents')

      .allowMultiple(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('videos', 'array', 'file', { array: true })
      .set('title', 'Videos')
      .set('description', 'Video Files (.mp4)')
      .allowMultiple(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('files', 'array', 'file', { array: true })
      .set('title', 'Files')
      .set('description', 'Any type of file')
      .allowMultiple(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('object', 'array', 'objectArray')
      .set('title', 'JSON')
      .set('description', 'A JSON object')
      .allowMultiple(true)
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )
    .addInput(
        component
          .createInput('persistData', 'string', 'text')
          .set('title', 'File Storage Mode')
          .set('description', 'Whether to save the files permanently or make them expire after a certain amount of time')
          .setChoices(['Permanent', "Expiring"], "Permanent")
          .toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {

    const deleteData = (p: any) => {
      delete p.data;
      return p;
    };

    if(payload.persistData !== "Expiring") {
      if (payload.images && payload.images.length > 0) {
          await Promise.all(payload.images.map(async (image: any) => {
          return ctx.app.cdn.setExpiry(image, ctx.userId, null)
        }))
      }
      if (payload.audio && payload.audio.length > 0) {
        await Promise.all(payload.audio.map(async (audio: any) => {
          return ctx.app.cdn.setExpiry(audio, ctx.userId, null)
        }))
      }
      if (payload.documents && payload.documents.length > 0) {
        await Promise.all(payload.documents.map(async (doc: any) => {
          return ctx.app.cdn.setExpiry(doc, ctx.userId, null)
        }))
      }
      if (payload.videos && payload.videos.length > 0) {
        await Promise.all(payload.videos.map(async (vid: any) => {
          return ctx.app.cdn.setExpiry(vid, ctx.userId, null)
        }))
      }
    }



    const attachments = {
      object: payload.object && !Array.isArray(payload.object) ? [payload.object] : payload.object,
      audio: payload?.audio?.map(deleteData),
      documents: payload?.documents?.map(deleteData),
      files: payload?.files?.map(deleteData),
      images: payload?.images?.map(deleteData),
      videos: payload?.videos?.map(deleteData)
    };
    const flags = ['no-picture'];
    const nickname = ctx.args?.xOmniNickName;

    await ctx.app.sendMessageToSession(
      ctx.sessionId,
      payload.text || ' ',
      payload.textType,
      attachments,
      flags,
      nickname,
      ctx.workflowId
    );

    return {}; // Everything OK. No output.
  });

const ChatOutputComponent = component.toJSON();

export default ChatOutputComponent;
