/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';
const block = OAIBaseComponent.create('omnitool', 'token_count');

block
  .fromScratch()
  .set('description', 'Estimates the number of tokens in a string')
  .set('title', 'Token Count')
  .set('category', Category.TEXT_ANALYSIS)
  .setMethod('X-CUSTOM')
  .addInput(block.createInput('Text', 'string', 'text').set('description', 'A string').setRequired(true).toOmniIO())
  .addOutput(block.createOutput('Count', 'number').set('description', 'Output number').toOmniIO())
  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    const text = payload.Text;
    console.log('text', text);

    let tokenCount = 0;

    // Split the text by spaces, and some common punctuation marks
    const words = text.split(/\s+|[.,!?;]\s*/);

    for (const word of words) {
      if (word.length === 0) continue; // Skip empty strings

      if (word.length > 15) {
        tokenCount += word.length; // If more than 15 letters, add the length as a conservative guess
      } else if (/^[A-Za-z]+$/.test(word)) {
        // Latin alphabet
        tokenCount += 1.3; // Assume 1.3 tokens per English word on average
      } else {
        tokenCount += 3; // Guess 3 tokens per non-english word on average
      }
    }

    return { Count: Math.ceil(tokenCount) };
  });

const TokenCountBlock = block.toJSON();
export default TokenCountBlock;
