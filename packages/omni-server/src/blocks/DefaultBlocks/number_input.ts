/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Number Input: A standard number input block
// --------------------------------------------------------------------------

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';
import defaultMeta from './meta.json' assert { type: 'json' };
import deepmerge from 'deepmerge';

const NS_OMNI = 'omnitool';

const block = OAIBaseComponent.create(NS_OMNI, 'number_input')
  .fromScratch()
  .set(
    'description',
    'Allows input of numerical value, formatting of numbers and access to utility functions such as random values and timestamp'
  )
  .set('title', 'Number Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-CUSTOM');

block
  .addInput(
    block
      .createInput('number', 'Number')
      .set('description', 'Input number')
      .setRequired(true)
      .setDefault(1)
      .toOmniIO()
  )

  .addOutput(block.createOutput('number', 'number', 'number').set('description', 'Output number').toOmniIO())

  .addControl(
    block
      .createControl('number_format')
      .set('title', 'Format')
      .set('description', 'Optionally choose a specific number format for the input.')
      .setChoices(
        [
          { title: 'Unchanged', value: 'any', description: 'Do not perform any modification' },
          { title: 'Integer', value: 'integer', description: 'Convert to an integer' },
          { title: 'Floating Point', value: 'float', description: 'Convert to floating point' },
          { title: 'Round', value: 'round', description: 'Round to the nearest integer' },
          { title: 'Ceiling', value: 'ceil', description: 'Round up to the nearest integer' },
          { title: 'Floor', value: 'floor', description: 'Round down to the nearest integer' },
          { title: 'Timestamp', value: 'timestamp', description: 'Current unix timestamp plus number' },
          { title: 'Random', value: 'random', description: 'Multiply input with a random number' }
        ],
        'any'
      )

      .toOmniControl()
  )

  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    const { number_format, number } = payload;

    if (number_format === 'integer') {
      return { number: parseInt(number) };
    } else if (number_format === 'round') {
      return { number: Math.round(number) };
    } else if (number_format === 'ceil') {
      return { number: Math.ceil(number) };
    } else if (number_format === 'floor') {
      return { number: Math.floor(number) };
    } else if (number_format === 'random') {
      return { number: parseFloat(number) * Math.random() };
    } else if (number_format === 'timestamp') {
      return { number: Date.now() + parseFloat(number) };
    } else {
      return { number: parseFloat(number) };
    }
  })

  .setMeta(deepmerge({ source: { summary: block.data.description } }, defaultMeta));

const NumberInputBlock = block.toJSON();

export default NumberInputBlock;
