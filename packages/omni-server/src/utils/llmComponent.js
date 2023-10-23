/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check
import { createComponent } from './component.js';
import { getModelNameAndProviderFromId } from './llm.js';
import { getLlmChoices } from './llms.js';

async function getLlmQueryInputs(use_openai_default = false) {
  const input = [];

  input.push({
    name: 'instruction',
    type: 'string',
    description: 'Instruction(s)',
    defaultValue: 'You are a helpful bot answering the user with their question to the best of your abilities',
    customSocket: 'text'
  });
  input.push({ name: 'prompt', type: 'string', customSocket: 'text', description: 'Prompt(s)' });
  input.push({
    name: 'temperature',
    type: 'number',
    defaultValue: 0.7,
    minimum: 0,
    maximum: 2,
    description: 'The randomness regulator, higher for more creativity, lower for more structured, predictable text.'
  });

  if (use_openai_default) {
    const llm_choices = await getLlmChoices();
    const model_id_input = {
      name: 'model_id',
      type: 'string',
      defaultValue: 'gpt-3.5-turbo-16k|openai',
      choices: llm_choices,
      customSocket: 'text'
    };
    input.push(model_id_input);
  } else {
    input.push({
      name: 'model_id',
      type: 'string',
      customSocket: 'text',
      description: 'The provider of the LLM model to use'
    });
  }

  input.push({
    name: 'args',
    title: 'Model Args',
    type: 'object',
    customSocket: 'object',
    description: 'Extra arguments provided to the LLM'
  });

  return input;
}

const LLM_QUERY_OUTPUT = [
  {
    name: 'answer_text',
    type: 'string',
    customSocket: 'text',
    description: 'The answer to the query',
    title: 'Answer'
  },
  {
    name: 'answer_json',
    type: 'object',
    customSocket: 'object',
    description: 'The answer in json format, with possibly extra arguments returned by the LLM',
    title: 'Json'
  }
];

const LLM_QUERY_CONTROL = null;
// TBD: use controls for temperature (slider) and args (json editer/viewer)
//[
// { name: "temperature", placeholder: "AlpineNumWithSliderComponent" },];
// { name: "args", title: "Extra args", placeholder: "AlpineCodeMirrorComponent", description: "Extra Args passed to the LLM model" },
//];

// @ts-ignore
async function async_getLlmQueryComponent(model_provider, links, payloadParser, use_openai_default = false) {
  const group_id = model_provider;
  const id = 'llm_query';
  const title = `LLM Query via ${model_provider}`;
  const category = 'LLM';
  const description = `Query a LLM with ${model_provider}`;
  const summary = `Query the specified LLM via ${model_provider}`;
  const inputs = await getLlmQueryInputs(use_openai_default);
  const outputs = LLM_QUERY_OUTPUT;
  const controls = LLM_QUERY_CONTROL;

  const component = createComponent(
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
    payloadParser
  );
  return component;
}

// @ts-ignore
function extractLlmQueryPayload(payload, model_provider) {
  if (!payload) throw new Error('No payload provided.');

  const instruction = payload.instruction;
  const prompt = payload.prompt;
  const temperature = payload.temperature || 0;
  const model_id = payload.model_id;
  const args = payload.args;

  if (!prompt) throw new Error('ERROR: no prompt provided!');

  const splits = getModelNameAndProviderFromId(model_id);
  const passed_model_name = splits.model_name;
  const passed_provider = splits.model_provider;

  if (passed_provider !== model_provider)
    throw new Error(`ERROR: model_provider (${passed_provider}) != ${model_provider}`);

  return {
    instruction,
    prompt,
    temperature,
    model_name: passed_model_name,
    args
  };
}

export { getLlmQueryInputs, async_getLlmQueryComponent, extractLlmQueryPayload };
export { LLM_QUERY_OUTPUT, LLM_QUERY_CONTROL };
