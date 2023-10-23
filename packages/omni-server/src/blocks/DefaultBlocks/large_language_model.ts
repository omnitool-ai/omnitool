/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';
const block = OAIBaseComponent.create('omnitool', 'large_language_model');

block
  .fromScratch()
  .set(
    'description',
    "Provides an interface for text generation by leveraging multiple LLM providers like OpenAI, Replicate.com, and TextSynth. It allows users to specify a criteria such as speed or accuracy to tailor the AI's behavior. The block ensures compatibility with each AI model's limitations and offers fallback options."
  )
  .set('title', 'Large Language Model')
  .set('category', Category.TEXT_GENERATION)
  .setMethod('X-CUSTOM')
  .addInput(
    block.createInput('Instruction', 'string', 'text').set('description', 'A string').setRequired(true).toOmniIO()
  )
  .addInput(block.createInput('Prompt', 'string', 'text').set('description', 'A string').setRequired(true).toOmniIO())
  .addOutput(block.createOutput('Reply', 'string', 'text').set('description', 'A string').toOmniIO());

const controlComposer = block.createControl('Criteria');
controlComposer.setRequired(true).setControlType('AlpineSelectComponent');
controlComposer.setChoices([
  { title: 'Fast', value: 'fast' },
  { title: 'Accurate', value: 'accurate' },
  { title: 'Free', value: 'free' },
  { title: 'Cheap', value: 'cheap' },
  { title: 'Creative', value: 'creative' }
]);
block.addControl(controlComposer.toOmniControl());

const count_tokens = async (text: string, ctx: WorkerContext) => {
  const token_count_result = await ctx.app.blocks.runBlock(ctx, 'omnitool.token_count', { Text: text });
  return token_count_result.Count;
};

const can_run_block = async (ctx: WorkerContext, blockName: string): Promise<boolean> => {
  const block = await ctx.app.blocks.getInstance(blockName, ctx.userId);
  const result: boolean = block && (await ctx.app.blocks.canRunBlock(block, ctx.userId));
  return result;
};

const run_text_synth = async (prompt: string, instruction: string, criteria: string, ctx: WorkerContext) => {
  if (!(await can_run_block(ctx, 'textsynth.generateCompletion'))) {
    return null;
  }

  let ts_prompt = `INSTRUCTION: You are helpful math assistant. Answer correctly and be concise
PROMPT: What is 5 + 3?
RESPONSE: 8

INSTRUCTION: You are a knowledgeable geography assistant.
PROMPT: What is the capital of France?
RESPONSE: Paris

INSTRUCTION: You are an assistant knowledgeable about animals.
PROMPT: What is the largest species of shark?
RESPONSE: The whale shark

INSTRUCTION: You are linguist assistant.
PROMPT: Give me a name that rhymes with Mark.
RESPONSE: Clark

INSTRUCTION: ${instruction}`;

  if (criteria === 'accurate') {
    ts_prompt += ' Be as accurate as possible.\n';
  } else if (criteria === 'creative') {
    ts_prompt += ' Use extreme creativity.\n';
  } else {
    ts_prompt += ' Be concise.\n';
  }

  ts_prompt += `PROMPT: ${prompt}\nRESPONSE: `;

  const args = {
    prompt: ts_prompt
  };
  const response = await ctx.app.blocks.runBlock(ctx, 'textsynth.generateCompletion', args);

  let text =
    response.text || 'TextSynth was unable to generate a reply. Check your TextSynth credentials at textsynth.com';

  const instruction_index = text.indexOf('INSTRUCTION');
  if (instruction_index > 3) {
    text = text.substring(0, instruction_index);
  }

  return text.trim();
};

const run_replicate_llm = async (
  prompt: string,
  instruction: string,
  criteria: string,
  ctx: WorkerContext
) => {
  let blockName = 'omni-core-replicate:run.meta/llama-2-70b-chat'
  if (criteria === 'fast' || criteria === 'cheap') {
    blockName = 'omni-core-replicate:run.meta/llama-2-13b-chat'
  }
  if (!(await can_run_block(ctx, blockName))) {
    return null;
  }

  const temperature = criteria === 'creative' ? 0.75 : 0.5;
  const args = {
    prompt,
    system_prompt: instruction,
    temperature
  };

  const response = await ctx.app.blocks.runBlock(ctx, blockName, args, undefined, { cache: 'user' });

  let text = response.output;
  if (typeof text === 'string') {
    text = text.replace(/\n\n|\n/g, (match) => (match === '\n\n' ? '\n' : ''));
  }

  return text || 'Replicate.com problem';
};

const run_open_ai = async (prompt: string, instruction: string, criteria: string, ctx: WorkerContext) => {
  if (!(await can_run_block(ctx, 'openai.simpleChatGPT'))) {
    return null;
  }

  const prompt_token_count = await count_tokens(instruction + '/' + prompt, ctx);

  let models = await ctx.app.blocks.runBlock(ctx, 'openai.getGPTModels', {}, undefined, { cache: 'user' });

  if (!models.models) {
    // Missing key?
    omnilog.error('No models available');
    return models;
  }

  models = models.models;

  const response_token_count = 1024; // How many tokens in the reply (guess)

  const token_count = prompt_token_count + response_token_count;

  let model = 'gpt-3.5-turbo'; // 4k context
  if (token_count > 4096 && models.includes('gpt-3.5-turbo-16k')) {
    model = 'gpt-3.5-turbo-16k';
  }
  if (token_count > 16384 && models.includes('gpt-4-32k')) {
    model = 'gpt-4-32k';
  }

  if (criteria === 'accurate') {
    if (models.includes('gpt-4')) {
      model = 'gpt-4'; // 8k context
    }
    if (token_count > 8192 && models.includes('gpt-4-32k')) {
      model = 'gpt-4-32k';
    }
  }

  if (criteria === 'cheap') {
    model = 'gpt-3.5-turbo';
  }

  let token_limit = 4096;
  if (model.includes('gpt-4')) {
    token_limit = 8192;
  }
  if (model.includes('-16k')) {
    token_limit = 16384;
  }
  if (model.includes('-32k')) {
    token_limit = 32768;
  }

  if (token_count > token_limit) {
    console.log(`LLM: Dropped tokens on ${model}, ${token_count} / ${token_limit}. Request may fail.`);
  }

  const args: any = {
    prompt,
    model,
    instruction
  };

  if (criteria === 'creative') {
    args.temperature = 0.9;
  }

  const response = await ctx.app.blocks.runBlock(ctx, 'openai.simpleChatGPT', args);

  return response.text || 'OpenAI problem';
};

block.setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
  const instruction = payload.Instruction;
  const prompt = payload.Prompt;
  const criteria = payload.Criteria;

  let Reply = null;

  if (!Reply && criteria !== 'free') {
    Reply = await run_open_ai(prompt, instruction, criteria, ctx);
  }

  if (!Reply && criteria !== 'free') {
    Reply = await run_replicate_llm(prompt, instruction, criteria, ctx);
  }

  // TODO: HuggingFace
  // TODO: Claude
  // TODO: PaLM
  // TODO: Oobabooga

  if (!Reply) {
    Reply = await run_text_synth(prompt, instruction, criteria, ctx);
  }

  if (!Reply) {
    Reply = 'Unable to run a large language model. Check your credentials.';
  }

  return { Reply };
});

const LargeLanguageModelBlock = block.toJSON();
export default LargeLanguageModelBlock;
