/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check
import { getModelNameAndProviderFromId, DEFAULT_UNKNOWN_CONTEXT_SIZE } from './llm.js';
import { Llm_Openai } from './llm_Openai.js';
import { runBlock } from './blocks.js';

const DEFAULT_LLM_MODEL_ID = 'gpt-3.5-turbo|openai';

const llm_model_types = {};
const llm_context_sizes = {};

// @ts-ignore
const default_providers = [];
const llm_Openai = new Llm_Openai();
default_providers.push(llm_Openai);

async function getLlmChoices() {
  // @ts-ignore
  const choices = [];
  // @ts-ignore
  for (const provider of default_providers) {
    // @ts-ignore
    await provider.getModelChoices(choices, llm_model_types, llm_context_sizes);
  }
  // @ts-ignore
  return choices;
}

// @ts-ignore
function getBlockName(model_id) {
  const splits = getModelNameAndProviderFromId(model_id);
  // @ts-ignore
  const model_provider = splits.model_provider;
  let block_name = `omni-extension-${model_provider}:${model_provider}.llm_query`;
  if (model_provider === 'openai') {
    block_name = `omni-core-llms:${model_provider}.llm_query`;
  }
  return block_name;
}

/**
 * @param {any} ctx
 * @param {any} prompt
 * @param {any} instruction
 * @param {any} model_id
 * @param {number} [temperature=0]
 * @param {any} [args=null]
 * @returns {Promise<{ answer_text: string; answer_json: { function_arguments_string?: any; function_arguments?: any; total_tokens?: number; answer: string } | null; }>}
 */
async function queryLlmByModelId(ctx, prompt, instruction, model_id, temperature = 0, args = null) {
  const block_name = getBlockName(model_id);
  const block_args = { prompt, instruction, model_id, temperature, args };
  const response = await runBlock(ctx, block_name, block_args);
  return response;
}

// @ts-ignore
function getModelMaxSize(model_name, use_a_margin = true) {
  const context_size = getModelContextSize(model_name);
  if (!use_a_margin) return context_size;

  const safe_size = Math.floor(context_size * 0.9);
  return safe_size;
}

// @ts-ignore
function getModelContextSize(model_name) {
  if (!(model_name in llm_context_sizes)) return DEFAULT_UNKNOWN_CONTEXT_SIZE;

  // @ts-ignore
  const context_size = llm_context_sizes[model_name];
  return context_size;
}

export { getLlmChoices, queryLlmByModelId, getModelMaxSize };
export { DEFAULT_LLM_MODEL_ID };
