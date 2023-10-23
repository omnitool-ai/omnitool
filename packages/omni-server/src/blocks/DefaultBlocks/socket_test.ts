/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import {
  OAIBaseComponent,
  type WorkerContext,
  OmniComponentMacroTypes,
  type ICustomSocketOpts,
  BlockCategory as Category
} from 'omni-sockets';
const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'socket_test')
  .fromScratch()
  .set('description', 'Verifies all combinations of socket types for testing purposes.')
  .set('title', 'Socket Test Block')
  .set('category', Category.TESTING)
  .setMethod('X-CUSTOM');

const inputTypePairs: Array<[string, string, string, ICustomSocketOpts | null]> = [
  ['text', 'string', 'text', null],
  ['string', 'string', 'string', null],
  ['number', 'number', 'number', null],
  ['integer', 'number', 'integer', null],
  ['float', 'number', 'float', null],
  ['boolean', 'boolean', 'boolean', null],

  ['object', 'object', 'object', null],
  ['cdnObject', 'object', 'cdnObject', null], // type = 'file'
  ['image', 'object', 'image', null],
  ['audio', 'object', 'audio', null],
  ['document', 'object', 'document', null],
  ['imageB64', 'string', 'image', { format: 'base64' }],

  ['textArray', 'array', 'text', { array: true }],
  ['objectArray', 'array', 'object', { array: true }],
  ['cdnObjectArray', 'array', 'cdnObject', { array: true }], // type = 'file'
  ['imageArray', 'array', 'image', { array: true }],
  ['audioArray', 'array', 'audio', { array: true }],
  ['documentArray', 'array', 'document', { array: true }],
  ['imageB64Array', 'array', 'image', { array: true, format: 'base64' }]
];

const outputTypePairs: Array<[string, string, string, ICustomSocketOpts | null]> = [
  ['text', 'string', 'text', null],
  ['string', 'string', 'string', null],
  ['number', 'number', 'number', null],
  ['integer', 'number', 'integer', null],
  ['float', 'number', 'float', null],
  ['boolean', 'boolean', 'boolean', null],

  ['object', 'object', 'object', null],
  ['cdnObject', 'object', 'cdnObject', null], // type = 'file'
  ['image', 'object', 'image', null],
  ['audio', 'object', 'audio', null],
  ['document', 'object', 'document', null],
  ['image(B64 test)', 'object', 'image', null],

  ['textArray', 'array', 'text', { array: true }],
  ['objectArray', 'array', 'object', { array: true }],
  ['cdnObjectArray', 'array', 'cdnObject', { array: true }], // type = 'file'
  ['imageArray', 'array', 'image', { array: true }],
  ['audioArray', 'array', 'audio', { array: true }],
  ['documentArray', 'array', 'document', { array: true }],
  ['imageArray(B64 test)', 'array', 'image', { array: true }]
];

inputTypePairs.forEach(([socketName, inputType, customSocket, socketOpts]) => {
  const inputSocket = component
    .createInput(socketName, inputType, customSocket, socketOpts && typeof socketOpts === 'object' ? socketOpts : {})
    .toOmniIO();
  component.addInput(inputSocket);
});

outputTypePairs.forEach(([socketName, inputType, customSocket, socketOpts]) => {
  const outputSocket = component
    .createOutput(socketName, inputType, customSocket, socketOpts && typeof socketOpts === 'object' ? socketOpts : {})
    .set('description', `An output of type ${inputType}`)
    .toOmniIO();
  component.addOutput(outputSocket);
});

component.addInput(
  component
    .createInput('integerSelector', 'integer')
    .setChoices(
      [
        { title: 'Option 1001', value: 1001 },
        { title: 'Option 1002', value: 1002 },
        { title: 'Option 1003', value: 1003 }
      ],
      1001
    )
    .toOmniIO()
);
component.addInput(
  component
    .createInput('stringSelector', 'string')
    .setChoices(
      [
        { title: 'Option string1', value: 'this is selector string1' },
        { title: 'Option string2', value: 'this is selector string2' },
        { title: 'Option string3', value: ' this is selector string3' }
      ],
      'string2'
    )
    .toOmniIO()
);
component.addInput(
  component
    .createInput('Assert', 'object')
    .set('title', 'Test Assert')
    .set('description', 'An object containing expected values for each output type to assert the output values against')
    .toOmniIO()
);

component.addOutput(
  component
    .createOutput('testReport', 'object')
    .set('title', 'Test Report')
    .set('description', 'A JSON containing the test report')
    .toOmniIO()
);

component.setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
  const output: any = {};
  const testReport: any = {};

  // data type socket test cases
  inputTypePairs.forEach(([socketName, inputType]) => {
    let correspondingOutput = socketName;

    if (inputType === 'imageB64') {
      correspondingOutput = 'image(B64 test)';
    } else if (inputType === 'imageB64Array') {
      correspondingOutput = 'imageArray(B64 test)';
    }
    output[correspondingOutput] = payload[socketName];

    if (payload.Assert) {
      // Check if the assert object has a corresponding property to validate
      if (payload.assert.hasOwnProperty(correspondingOutput)) {
        testReport[correspondingOutput] = {
          expected: payload.assert[correspondingOutput],
          actual: output[correspondingOutput],
          status: payload.assert[correspondingOutput] === output[correspondingOutput] ? 'pass' : 'fail'
        };
      }
    }
  });

  // other special socket test cases
  output.text += '\n\n integerSelector: ' + payload.integerSelector;
  output.text += '\n\n stringSelector: ' + payload.stringSelector;
  if (payload.assert) {
    output.testReport = testReport;
  }

  return output;
});

const SocketTestBlock = component.toJSON();
export default SocketTestBlock;
