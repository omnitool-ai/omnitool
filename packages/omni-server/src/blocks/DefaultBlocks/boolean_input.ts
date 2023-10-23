/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';
const component = OAIBaseComponent.create(NS_OMNI, 'input_boolean')
  .fromScratch()
  .set('description', 'Input boolean values.')
  .set('title', 'Boolean Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component
      .createInput('boolean', 'boolean', undefined, { array: false })
      .set('title', 'Yes/No')
      .set('description', 'A yes/no value')
      .setRequired(true)
      .toOmniIO()
  )
  .addOutput(
    component
      .createOutput('boolean', 'boolean', undefined, { array: false })
      .set('title', 'Yes/No')
      .set('description', 'A yes/no value')
      .toOmniIO()
  );
component.setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
  console.log('boolean input', payload.boolean);
  return { boolean: payload.boolean };
});

const BooleanInputComponent = component.toJSON();
export default BooleanInputComponent;
