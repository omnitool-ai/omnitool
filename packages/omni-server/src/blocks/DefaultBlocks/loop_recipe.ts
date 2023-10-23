/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { combineValues, runRecipe, blockOutput, createComponent } from '../../../src/utils/omni-utils.js';
import { type WorkerContext, BlockCategory as Category } from 'omni-sockets';

const group_id = 'omnitool';
const id = 'loop_recipe';
const title = `Loop Recipe`;
const category = Category.RECIPE_OPERATIONS;
const description = `Run a recipe, possibly multiple time based on an array of values`;
const summary = description;

const inputs = [
  { name: 'recipe_id', type: 'string', customSocket: 'text', description: 'The UUID of the recipe to loop' },
  {
    name: 'driving_input',
    type: 'object',
    customSocket: 'object',
    description:
      'A json containing the name of the input variable to loop the recipe over its array of values. If using Chat Input in the recipe, the name should be "text", "images", "audio", or "documents"'
  },
  {
    name: 'other_inputs',
    type: 'object',
    customSocket: 'object',
    description:
      'All the other inputs to pass to the recipe, in the format {input_name1:value1, input_name2:value2, etc. }'
  }
];
const outputs = [
  {
    name: 'text',
    type: 'string',
    customSocket: 'text',
    description: 'Texts returned by recipes, each separated with |'
  },
  { name: 'images', type: 'array', customSocket: 'imageArray', description: 'Images returned by recipes' },
  { name: 'audio', type: 'array', customSocket: 'audioArray', description: 'Audio returned by recipes' },
  { name: 'documents', type: 'array', customSocket: 'documentArray', description: 'Documents returned by recipes' },
  { name: 'videos', type: 'array', customSocket: 'fileArray', description: 'Videos returned by recipes' },
  { name: 'files', type: 'array', customSocket: 'fileArray', description: 'Files returned by recipes' },
  { name: 'objects', type: 'array', customSocket: 'objectArray', description: 'Objects returned by recipes' },
  {
    name: 'result_array',
    type: 'array',
    customSocket: 'objectArray',
    description: 'An array of all the recipes results'
  },
  { name: 'info', type: 'string', customSocket: 'text', description: 'Information about the block execution' }
];

const controls = null;
const links = {};

export const LoopRecipeComponent = createComponent(
  group_id,
  id,
  title,
  category,
  description,
  summary,
  links,
  inputs,
  outputs,
  controls,
  parsePayload
);

async function parsePayload(payload: any, ctx: WorkerContext) {
  const driving_input = payload.driving_input; // in the format {<type> : <array of values>}
  const other_args = payload.other_inputs || {};
  const recipe_id = payload.recipe_id;
  let info = '';
  // ---------------------
  if (!recipe_id) throw new Error(`No recipe id specified`);
  if (!driving_input) throw new Error(`No loop input json specified`);

  const input_keys = Object.keys(driving_input);
  const input_name = input_keys[0].toLowerCase();
  if (!input_name || input_name == '') throw new Error(`No input name specified`);

  const loop_input_value = driving_input[input_name];
  const args = { ...other_args };
  if ('botIdentity' in args) delete args.botIdentity;
  let input_array = [];
  if (input_name && Array.isArray(loop_input_value)) {
    input_array = loop_input_value;
  } else {
    input_array = [loop_input_value];
  }

  let texts: any[] | null = [];
  let images: any[] | null = [];
  let audio: any[] | null = [];
  let videos: any[] | null = [];
  let files: any[] | null = [];
  let objects: any[] | null = [];
  let documents: any[] | null = [];

  const result_array: any[] = [];
  for (const input of input_array) {
    if (!input) continue;
    args[input_name] = input;

    try {
      const result: any = await runRecipe(ctx, recipe_id, args);
      if (result) {
        result_array.push(result);
        if ('text' in result) texts = combineValues(texts, result.text);
        if ('images' in result) images = combineValues(images, result.images);
        if ('audio' in result) audio = combineValues(audio, result.audio);
        if ('documents' in result) documents = combineValues(documents, result.documents);
        if ('videos' in result) videos = combineValues(videos, result.videos);
        if ('files' in result) files = combineValues(files, result.files);
        if ('objects' in result) objects = combineValues(objects, result.objects);
      } else info += `WARNING: could not read any value from recipe_id ${recipe_id} | `;
    } catch {
      info += `Error running recipe ${recipe_id} with input ${input} | `;
      continue;
    }
  }

  // text is a bit of a special case as we don't support textArray for now. TBD: support text arrays
  let text = '';
  if (texts) {
    for (const text_value of texts) {
      if (text == '') text = text_value;
      else text = `${text} | ${text_value}`;
    }
  }

  const return_value = blockOutput({ text, images, audio, documents, videos, files, objects, result_array, info });
  return return_value;
}
