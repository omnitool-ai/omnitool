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

const context_size_for_model = (model: string) => {
  // https://platform.openai.com/docs/models/continuous-model-upgrades
  if (model.includes('-16k')) {
    return 16384; // === 16 * 1024
  }
  if (model.includes('-32k')) {
    return 32768; // === 32 * 1024
  }
  if (model === 'gpt-4-1106-preview') {
    return 128000; // Note: 128 * 1000, not 128 * 1024.
  }
  if (model === 'gpt-4-vision-preview') {
    return 128000; // Note: 128 * 1000, not 128 * 1024.
  }
  if (model.includes('gpt-4')) {
    return 8192;
  }

  if (model === 'gpt-3.5-turbo-1106') {
    return 16384;
  }

  if (model === 'gpt-3.5-turbo') {
    //Will update to gpt-3.5-turbo-1106 starting Dec 11, 2023.
    if (Date.now() > 1670764800000) { // 2023-12-11T00:00:00.000Z
      return 16384;
    }
  }

  return 4096; // Most likely an older GPT-3 model.
}

const price_for_model = (model: string): number => {
  // #https://openai.com/pricing/
  // Correct at 2023-11-07

  // GPT-4 series
  if (model.includes('gpt-4-1106')) { // e.g. preview and vision models.
    return 0.0200; // Average of $0.01 for input and $0.03 for output per 1K tokens
  }
  if (model.includes('gpt-4-32k')) {
    return 0.0900; // Average of $0.06 for input and $0.12 for output per 1K tokens
  }
  if (model.includes('gpt-4')) {
    return 0.0450; // Average of $0.03 for input and $0.06 for output per 1K tokens
  }

  // GPT-3.5 series
  if (model.includes('instruct')) {
    return 0.0018; // Average of $0.0015 for input and $0.0020 for output per 1K tokens
  }
  if (model.startsWith('gpt-3.5-turbo')) {
    return 0.0015; // Average of $0.0010 for input and $0.0020 for output per 1K tokens
  }

  // Default price if the model is not recognized
  console.log("OpenAILLM: Unknown model", model)
  return 0.1000;
};

const run_open_ai = async (prompt: string, instruction: string, criteria: string, ctx: WorkerContext) => {
  if (!(await can_run_block(ctx, 'openai.simpleChatGPT'))) {
    return null;
  }

  const prompt_token_count = await count_tokens(instruction + '/' + prompt, ctx);

  const models = await ctx.app.blocks.runBlock(ctx, 'openai.getGPTModels', {}, undefined, { cache: 'user' });

  if (!models.models) {
    // Missing key?
    omnilog.error('No models available');
    return models;
  }

  const response_token_count = 1024; // How many tokens in the reply (guess)

  const token_count = prompt_token_count + response_token_count;

  const possibleModels = models.models
    .filter((m: string) => token_count <= context_size_for_model(m))
    .filter((m: string) => !m.includes('vision'))
    .sort((a: string, b: string) => price_for_model(a) - price_for_model(b));


  if (possibleModels.length === 0) {
    console.log(`LLM: No models available for ${token_count} tokens`);
    return 'No models available for input size';
  }

  let model = possibleModels[0]; // The cheapest model which fits the context size.

  if (criteria === 'accurate') {
    const gpt4Models = possibleModels.filter((m:string) => m.includes('gpt-4'));
    if (gpt4Models.length > 0) {
      model = gpt4Models[0]; // Cheapest GPT-4 model
    }
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
