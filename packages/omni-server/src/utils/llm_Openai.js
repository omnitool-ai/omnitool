/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check
import { runBlock } from './blocks.js';
import { Llm, fixJsonString, generateModelId, deduceLlmTitle, deduceLlmDescription } from './llm.js';
import { is_valid, clean_string } from './utils.js';
import { Tokenizer_Openai } from './tokenizer_Openai.js';

const LLM_PROVIDER_OPENAI_SERVER = 'openai'; // we may need to support Azure and other providers (e.g. Poe)
const LLM_MODEL_TYPE_OPENAI = 'openai';
const BLOCK_OPENAI_ADVANCED_CHATGPT = 'openai.advancedChatGPT';
const LLM_CONTEXT_SIZE_MARGIN = 500;
const GPT3_MODEL_SMALL = 'gpt-3.5-turbo';
const GPT3_MODEL_LARGE = 'gpt-3.5-turbo-16k';
const GPT3_SIZE_CUTOFF = 4096 - LLM_CONTEXT_SIZE_MARGIN;
const GPT4_MODEL_SMALL = 'gpt-4';
const GPT4_MODEL_LARGE = 'gpt-4-32k';
const GPT4_SIZE_CUTOFF = 8192 - LLM_CONTEXT_SIZE_MARGIN;
const ICON_OPENAI = '💰';
const llm_openai_models = [
  {
    model_name: GPT3_MODEL_SMALL,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 4096,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT3_MODEL_LARGE,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 16384,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT4_MODEL_SMALL,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 8192,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT4_MODEL_LARGE,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 32768,
    provider: LLM_PROVIDER_OPENAI_SERVER
  }
];

class Llm_Openai extends Llm {
  constructor() {
    const tokenizer_Openai = new Tokenizer_Openai();
    super(tokenizer_Openai);
    // @ts-ignore
    this.context_sizes[GPT3_MODEL_SMALL] = 4096;
    // @ts-ignore
    this.context_sizes[GPT3_MODEL_LARGE] = 16384;
    // @ts-ignore
    this.context_sizes[GPT4_MODEL_SMALL] = 8192;
    // @ts-ignore
    this.context_sizes[GPT4_MODEL_LARGE] = 16384;
  }

  // -----------------------------------------------------------------------
  /**
   * @param {any} ctx
   * @param {string} prompt
   * @param {string} instruction
   * @param {string} model_name
   * @param {number} [temperature=0]
   * @param {any} [args=null]
   * @returns {Promise<{ answer_text: string; answer_json: any; }>}
   */
  async query(ctx, prompt, instruction, model_name, temperature = 0, args = null) {
    const block_args = { ...args };
    block_args.user = ctx.userId;
    if (prompt !== '') block_args.prompt = prompt;
    if (instruction !== '') block_args.instruction = instruction;
    block_args.temperature = temperature;
    block_args.model = model_name;

    const response = await this.runLlmBlock(ctx, block_args);
    if (response.error) throw new Error(response.error);

    const total_tokens = response?.usage?.total_tokens || 0;
    let answer_text = response?.answer_text || '';
    const function_arguments_string = response?.function_arguments_string || '';
    let function_arguments = null;

    if (is_valid(function_arguments_string)) function_arguments = await fixJsonString(ctx, function_arguments_string);
    if (is_valid(answer_text)) answer_text = clean_string(answer_text);

    const answer_json = {};
    answer_json.function_arguments_string = function_arguments_string;
    answer_json.function_arguments = function_arguments;
    answer_json.total_tokens = total_tokens;
    answer_json.answer_text = answer_text;

    const return_value = {
      answer_text,
      answer_json
    };

    return return_value;
  }

  getProvider() {
    return LLM_PROVIDER_OPENAI_SERVER;
  }

  getModelType() {
    return LLM_MODEL_TYPE_OPENAI;
  }

  // @ts-ignore
  async getModelChoices(choices, llm_model_types, llm_context_sizes) {
    const models = Object.values(llm_openai_models);
    for (const model of models) {
      const model_name = model.model_name;
      const provider = model.provider;
      const model_id = generateModelId(model_name, provider);

      // @ts-ignore
      const title = model.title || deduceLlmTitle(model_name, provider, ICON_OPENAI);
      // @ts-ignore
      const description = model.description || deduceLlmDescription(model_name, model.context_size);

      // @ts-ignore
      llm_model_types[model_name] = model.type;
      llm_context_sizes[model_name] = model.context_size;

      const choice = { value: model_id, title, description };
      choices.push(choice);
    }
  }

  // @ts-ignore
  async runLlmBlock(ctx, args) {
    // TBD ensure all the runLLM blocks have the same exact response format
    // or clean it up here for openai

    const prompt = args.prompt;
    const instruction = args.instruction;
    const model = args.model;

    const prompt_cost = this.tokenizer.countTextTokens(prompt);
    const instruction_cost = this.tokenizer.countTextTokens(instruction);
    const cost = prompt_cost + instruction_cost;

    args.model = this.adjustModel(cost, model);

    let response = null;
    try {
      response = await runBlock(ctx, BLOCK_OPENAI_ADVANCED_CHATGPT, args);
    } catch (err) {
      // @ts-ignore
      const error_message = `Error running openai.advancedChatGPT: ${err.message}`;
      console.error(error_message);
      throw err;
    }
    return response;
  }

  // @ts-ignore
  adjustModel(text_size, model_name) {
    if (typeof text_size !== 'number') {
      throw new Error(`adjust_model: text_size is not a string or a number: ${text_size}, type=${typeof text_size}`);
    }

    if (model_name === GPT3_MODEL_SMALL) return model_name;

    if (model_name === GPT3_MODEL_LARGE) {
      if (text_size < GPT3_SIZE_CUTOFF) return GPT3_MODEL_SMALL;
      else return model_name;
    }

    if (model_name === GPT4_MODEL_SMALL) return model_name;

    if (model_name === GPT4_MODEL_LARGE) {
      if (text_size < GPT4_SIZE_CUTOFF) return GPT3_MODEL_SMALL;
      else return model_name;
    }

    throw new Error(`pick_model: Unknown model: ${model_name}`);
  }
}

export { Llm_Openai };
