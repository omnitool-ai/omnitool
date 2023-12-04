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
import type { Workflow } from 'omni-shared'

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'number_input_slider')
  .fromScratch()
  .set(
    'description',
    'Allows input of numerical value through a slider, with a min, max, default and step value'
  )
  .set('title', 'Number Input with Slider')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component
      .createInput('expand', 'boolean') 
      .set('description', 'Expand to show the slider options')
      .toOmniIO()
  )

  .addControl(
    component
        .createControl('button')
        .set('title', 'Update')
        .setControlType('AlpineButtonComponent')
        .setCustom('buttonAction', 'script')
        .setCustom('buttonValue', 'save')
        .set('description', 'Update')
        .toOmniControl()
  )
  .addOutput(component.createOutput('number', 'number', 'number').set('description', 'Output number').toOmniIO())
  .setMacro(OmniComponentMacroTypes.ON_SAVE, onSave)
  .setMacro(OmniComponentMacroTypes.EXEC, processPayload)
  .setMeta(deepmerge({ source: { summary: component.data.description } }, defaultMeta));

export const NumberInputSliderBlock = component.toJSON();


async function onSave(node: any, recipe: Workflow, ctx: { app: any, userId: string, inputs: any }) {
  const expand = node.data.expand;
  const min = node.data.min;
  const max = node.data.max;
  const def = node.data.default;
  const step = node.data.step;
  const inputsObject: any = {};
  if (expand == true)
  {
 
    const min_socket: Record <string,any> = {};
    min_socket.title = `* min`;
    min_socket.name = 'min';
    min_socket.type = 'number';
    min_socket.customSocket = 'number';
    inputsObject[min_socket.name] = min_socket;   

    const max_socket: Record <string,any> = {};
    max_socket.title = `* max`;
    max_socket.name = 'max';
    max_socket.type = 'number';
    max_socket.customSocket = 'number';
    inputsObject[max_socket.name] = max_socket;   

    const def_socket: Record <string,any> = {};
    def_socket.title = `* default`;
    def_socket.name = 'default';
    def_socket.type = 'number';
    def_socket.customSocket = 'number';
    inputsObject[def_socket.name] = def_socket;   

    const step_socket: Record <string,any> = {};
    step_socket.title = `* step`;
    step_socket.name = 'step';
    step_socket.type = 'number';
    step_socket.customSocket = 'number';
    inputsObject[step_socket.name] = step_socket;   
  }

  const number_socket: Record <string,any> = {};
  number_socket.title = `number`;
  number_socket.name = 'number';
  number_socket.type = 'number';
  number_socket.customSocket = 'number';

  if (def != undefined) { number_socket.default = def; }
  
  if (min != undefined && max != undefined) { 
    number_socket.minimum = min; 
    number_socket.maximum = max; 
  }
  if (step != undefined ) { number_socket.step = step; }

  inputsObject[number_socket.name] = number_socket;

  node.data['x-omni-dynamicInputs'] = inputsObject;
  return true;
}


async function processPayload(payload: any, ctx: WorkerContext) {
  const raw_number = payload.number;
  const number = parseFloat(raw_number);

  const result: Record <string,any> = {};
  result.result = { ok: true };
  result.number = number;  
  return result;
}

