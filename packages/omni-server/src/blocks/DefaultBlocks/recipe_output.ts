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

const component = OAIBaseComponent.create(NS_OMNI, 'recipe_output')
  .fromScratch()
  .set('title', 'Recipe Output')
  .set('category', Category.INPUT_OUTPUT)
  .set(
    'description',
    `Sets the API output for this recipe, used with the Run Recipe Block or when invoked via the REST API.  
    - To retrieve the output of the recipe, use the \`/api/v1/workflow/results?jobId=<jobId>\` endpoint.  
    - To retrieve file contents, use their file id (fid) with the \`/fid/<fid>\` endpoint on the server endpoint.  
    `

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
      .createInput('videos', 'array', 'video', { array: true })
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
      .createInput('objects', 'array', 'objectArray')
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
          delete image.data;
          return ctx.app.cdn.setExpiry(image, ctx.userId, null)
        }))
      }
      if (payload.audio && payload.audio.length > 0) {
        await Promise.all(payload.audio.map(async (audio: any) => {
          delete audio.data;
          return ctx.app.cdn.setExpiry(audio, ctx.userId, null)
        }))
      }
      if (payload.documents && payload.documents.length > 0) {
        await Promise.all(payload.documents.map(async (doc: any) => {
          delete doc.data;
          return ctx.app.cdn.setExpiry(doc, ctx.userId, null)
        }))
      }
      if (payload.videos && payload.videos.length > 0) {
        await Promise.all(payload.videos.map(async (vid: any) => {
          delete vid.data;
          return ctx.app.cdn.setExpiry(vid, ctx.userId, null)
        }))
      }
    }

    const result = {
      text: payload.text && !Array.isArray(payload.text) ? [payload.text] : payload.text,
      objects: payload.objects && !Array.isArray(payload.objects) ? [payload.objects] : payload.objects,
      artifacts:
      {
        audio: payload?.audio?.map(deleteData),
        documents: payload?.documents?.map(deleteData),
        files: payload?.files?.map(deleteData),
        images: payload?.images?.map(deleteData),
        videos: payload?.videos?.map(deleteData),
      },
      job:
      {
        userId: ctx.userId,
        jobId: ctx.jobId,
        recipeId: ctx.workflowId,
        errors: ctx.engine.errors && ctx.engine.errors.length > 0 ? ctx.engine.errors : null,
        success: !ctx.engine.errors || ctx.engine.errors.length === 0,
      },
      created: Date.now(),
    };

    const jobService = ctx.app.services.get('jobs');
    const storage = jobService.kvStorage;
    if (storage)
    {
      const tags = []
      tags.push('job.' + ctx.jobId)
      //TODO: Synchronize expiry
      storage.set('result.' + ctx.jobId, result, payload.persistData !== "Expiring" ? null: Date.now()+ 1000*60*60*24*30, tags, ctx.userId);
    }
    return {}
  });

const RecipeOutputComponent = component.toJSON();

export default RecipeOutputComponent;
