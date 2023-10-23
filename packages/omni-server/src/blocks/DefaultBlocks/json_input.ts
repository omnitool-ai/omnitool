/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'json_input')
  .fromScratch()
  .set('description', 'Input standard JSON data.')
  .set('title', 'JSON Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-PASSTHROUGH');
component
  .addInput(
    component
      .createInput('json', 'object')
      .set('title', 'JSON')
      .set('description', 'An input JSON object')
      .setRequired(true)
      .toOmniIO()
  )
  .addOutput(
    component.createOutput('json', 'object').set('title', 'JSON').set('description', 'The input JSON object').toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    const { json } = payload;
    return { json };
  });
const JsonInputComponent = component.toJSON();
export default JsonInputComponent;
