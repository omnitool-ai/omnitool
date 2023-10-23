/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';
const component = OAIBaseComponent.create(NS_OMNI, 'text_splitter')
  .fromScratch()
  .set('description', 'Split text into chunks based on the specified chunk size or delimiter')
  .set('title', 'Text Splitter')
  .set('category', Category.TEXT_MANIPULATION)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component
      .createInput('text', 'string')
      .set('title', 'Text')
      .set('description', 'A string')
      .setRequired(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('chunkSize', 'integer')
      .set('title', 'Chunk size')
      .set('description', 'Length of each chunk')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('delimiter', 'string')
      .set('title', 'Delimiter')
      .set('description', 'Delimiter to split the text')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('chunkPrefix', 'string')
      .set('title', 'Chunk prefix')
      .set('description', 'A string to prepend to each chunk')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('chunkPostfix', 'string')
      .set('title', 'Chunk postfix')
      .set('description', 'A string to append to each chunk')
      .toOmniIO()
  )
  .addOutput(
    component
      .createOutput('chunks', 'array', 'objectArray')
      .set('title', 'Chunks')
      .set('description', 'An array of text chunks')
      .toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    const text = payload.text;
    const chunkSize = payload.chunkSize;
    const delimiter = payload.delimiter;
    const chunkPrefix = payload.chunkPrefix ?? '';
    const chunkPostfix = payload.chunkPostfix ?? '';
    if (!chunkSize && !delimiter) {
      throw new Error('Either chunkSize or delimiter must be provided.');
    }

    let chunks: Array<{ text: string }>;

    if (delimiter) {
      chunks = text.split(delimiter).map((chunk: string) => {
        return { text: chunkPrefix + chunk.trim() + chunkPostfix };
      });
    } else {
      chunks = [];
      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push({ text: chunkPrefix + text.slice(i, i + chunkSize).trim() + chunkPostfix });
      }
    }

    return { chunks };
  });
const TextSplitterComponent = component.toJSON();
export default TextSplitterComponent;
