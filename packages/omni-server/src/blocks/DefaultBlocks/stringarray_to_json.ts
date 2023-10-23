/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { createComponent } from '../../../src/utils/omni-utils.js';
import { type WorkerContext, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const group_id = NS_OMNI;
const id = 'stringarray_to_json';
const title = 'String to JSON';
const category = Category.DATA_TRANSFORMATION;
const description = 'Transforms a string containing multiple values separated by a specified delimiter into a structured JSON format, with each value assigned the chosen data type (e.g., string, number, boolean, or object).';
const summary = description;

const inputs = [
  {
    name: 'string',
    type: 'string',
    customSocket: 'text',
    description: 'The string to be parsed and turned into an array of values.'
  },
  {
    name: 'type',
    type: 'string',
    customSocket: 'text',
    choices: ['string', 'number', 'boolean', 'object'],
    defaultValue: 'string',
    description: 'The type of the values in the array.'
  },
  {
    name: 'separator',
    type: 'string',
    customSocket: 'text',
    description:
      'The separator to use to split the values of the input variable to loop. If not specified, line-break will be used.'
  },
  {
    name: 'name',
    type: 'string',
    customSocket: 'text',
    description:
      'If specified, the json will have this structure: { <name> : [array_value1, array_value2...] }, if not it will use [array_value1, array_value2...]'
  }
];
const outputs = [
  { name: 'json', type: 'object', customSocket: 'object', description: 'The json created from the inputs.' },
  { name: 'info', type: 'string', customSocket: 'text', description: 'Information about the block execution' }
];

const controls = null;
const links = {};

export const StringarrayToJsonComponent = createComponent(
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
  const input_name = payload.name;
  const input_string = payload.string;
  const input_type = payload.type;
  const separator = payload.separator || '\n';

  if (!input_string) {
    throw new Error(`No string specified`);
  }

  let info = '';

  // break the input_string using the separator
  let values = [];
  if (separator == '\n') values = input_string.split(/\r?\n/);
  else values = input_string.split(separator);
  if (!values || values.length == 0)
    throw new Error(`No values found in the string ${input_string} using the separator ${separator}`);

  const value_array = [];

  for (let value of values) {
    try {
      if (input_type == 'number') value = Number(value);
      else if (input_type == 'boolean') {
        value = value.toLowerCase() === 'true';
        if (!value) value = value.toLowerCase() === '1';
        if (!value) value = value.toLowerCase() === 'yes';
        if (!value) value = value.toLowerCase() === 'y';
        if (!value) value = value.toLowerCase() === 'ok';
        if (!value) value = value.toLowerCase() === 'on';
      } else if (input_type == 'object') value = JSON.parse(value);

      if (value) {
        value_array.push(value);
      } else {
        info += `Value ${value} is not a valid ${input_type}; \n`;
      }
    } catch (e) {
      info += `Error parsing value ${value} to type ${input_type}: ${e}; \n`;
      continue;
    }
  }

  if (value_array.length == 0)
    throw new Error(`No values found in the string ${input_string} using the separator ${separator}`);
  let json = null;
  if (input_name && input_name.length > 0) {
    json = {};
    //@ts-ignore
    json[input_name] = value_array;
  } else {
    json = value_array;
  }

  return { result: { ok: true }, json, info };
}
