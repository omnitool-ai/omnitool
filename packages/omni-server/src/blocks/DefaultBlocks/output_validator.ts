/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'validator')
  .fromScratch()
  .set('title', 'Output Validator')
  .set('category', Category.TESTING)
  .set(
    'description',
    'Validate the output from sockets against a set of JSON assertions. An error will be thrown in case of any assertion failure.'
  )
  .setMethod('X-CUSTOM');

const inputTypes = ['string', 'boolean', 'number', 'array', 'object', 'assert'];

for (const inputType of inputTypes) {
  component.addInput(
    component
      .createInput(inputType, inputType === 'assert' ? 'object' : inputType)
      .set('title', inputType.charAt(0).toUpperCase() + inputType.slice(1))
      .set('description', `Input of type ${inputType}`)
      .toOmniIO()
  );
}

component.addOutput(
  component
    .createOutput('validationReport', 'object')
    .set('title', 'Validation Report')
    .set('description', 'A JSON formatted string containing the validation report')
    .toOmniIO()
);

component.setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
  try {
    const validationReport: any = {};
    let validationFailed = false;
    const failedInputs: string[] = [];

    inputTypes.forEach((inputType) => {
      // eslint-disable-next-line no-prototype-builtins
      if (inputType !== 'assert' && payload.assert && payload.assert.hasOwnProperty(inputType)) {
        const status = payload.assert[inputType] === payload[inputType] ? '✅ pass' : '❌fail';
        validationReport[inputType] = {
          expected: payload.assert[inputType],
          actual: payload[inputType],
          status
        };
        if (status === '❌fail') {
          validationFailed = true;
          failedInputs.push(`${inputType}: expected ${payload.assert[inputType]}, received ${payload[inputType]}`);
        }
      }
    });

    if (validationFailed) {
      throw new Error(`Validation failed for inputs: ${failedInputs.join(', ')}`);
    }
    return { validationReport };
  } catch (error) {
    console.error(error);
    // You can add more error handling logic here if needed
    throw error; // Re-throwing the error to propagate it up the call stack
  }
});

const ValidatorComponent = component.toJSON();

export default ValidatorComponent;
