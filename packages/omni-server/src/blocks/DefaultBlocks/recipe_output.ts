/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
//@ts-check

import { setComponentInputs, setComponentOutputs, setComponentControls, blockOutput } from '../../../src/utils/omni-utils.js';
import {
  OAIBaseComponent,
  OmniComponentMacroTypes,
  OmniComponentFlags,
  type WorkerContext,
  BlockCategory as Category
} from 'omni-sockets';

const group_id = 'omnitool';
const id = 'recipe_output';
const title = 'Recipe Output';
const category = Category.RECIPE_OPERATIONS;
const description =
  'Store the output of a recipe in the database, including text, images, audio, documents, videos, files, and objects. These stored outputs can be retrieved later for further use.';
const summary = description;

const inputs = [
  { name: 'text', type: 'string', customSocket: 'text' },
  { name: 'images', type: 'array', customSocket: 'imageArray' },
  { name: 'audio', type: 'array', customSocket: 'audioArray' },
  { name: 'documents', type: 'array', customSocket: 'documentArray' },
  { name: 'videos', type: 'array', customSocket: 'fileArray' },
  { name: 'files', type: 'array', customSocket: 'fileArray' },
  { name: 'objects', type: 'array', customSocket: 'objectArray' }
];
const outputs = [{ name: 'info', type: 'string', customSocket: 'text' }];
const controls = null;

let baseComponent = OAIBaseComponent.create(group_id, id)
  .fromScratch()
  .set('title', title)
  .set('category', category)
  .set('description', description)
  .setMethod('X-CUSTOM')
  .setMeta({
    source: {
      summary
    }
  });

baseComponent = setComponentInputs(baseComponent, inputs);
baseComponent = setComponentOutputs(baseComponent, outputs);
baseComponent.setFlag(OmniComponentFlags.UNIQUE_PER_WORKFLOW, true);
if (controls) baseComponent = setComponentControls(baseComponent, controls);
baseComponent.setMacro(OmniComponentMacroTypes.EXEC, parsePayload);

export const RecipeOutputComponent = baseComponent.toJSON();

async function parsePayload(payload: any, ctx: WorkerContext) {
  const text = payload.text;
  const images = payload.images;
  const audio = payload.audio;
  const documents = payload.documents;
  const videos = payload.videos;
  const files = payload.files;
  const objects = payload.objects;
  let info = '';
  // ---------------------
  const job_id = ctx.jobId;
  if (!job_id) throw new Error(`No recipe id found in the context`);

  const jobs_controller = ctx.app.jobs;
  const jobs = jobs_controller.jobs;
  const workflow_job = jobs.get(job_id);

  const json = { outputs: { text: '', images: [], audio: [], documents: [], videos: [], files: [], objects: [] } };
  const outputs = json.outputs;
  if (text) outputs.text = text;
  if (images) outputs.images = images;
  if (audio) outputs.audio = audio;
  if (documents) outputs.documents = documents;
  if (videos) outputs.videos = videos;
  if (files) outputs.files = files;
  if (objects) outputs.objects = objects;
  info += `job_id: ${job_id}: Saving outputs ${JSON.stringify(outputs)} to the database; | `;
  workflow_job.artifactsValue = outputs;

  const result = blockOutput({ info });
  return result;
}
