/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';
import convert from 'color-convert';

const block = OAIBaseComponent.create('omnitool', 'name_to_rgb');

block
  .fromScratch()
  .set('description', 'Translate color name to RGB value.')
  .set('title', 'Name to RGB')
  .set('category', Category.UTILITIES)
  .setMethod('X-CUSTOM');

block.addInput(
  block
    .createInput('Color Name', 'string', 'text')
    .set('description', 'Input color name, e.g., "red"')
    .setControl({ controlType: 'AlpineLabelComponent' })
    .toOmniIO()
);

block.addOutput(block.createOutput('Hex String', 'string', 'text').toOmniIO());

block.addOutput(block.createOutput('RGB String', 'string', 'text').toOmniIO());

block.addOutput(block.createOutput('Red', 'number').toOmniIO());

block.addOutput(block.createOutput('Green', 'number').toOmniIO());

block.addOutput(block.createOutput('Blue', 'number').toOmniIO());

block.setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
  const colorName = payload['Color Name'];

  // Convert color name to RGB using color-convert
  const [red, green, blue] = convert.keyword.rgb(colorName);
  const hexString = convert.rgb.hex(red, green, blue);
  const rgbString = `rgb(${red},${green},${blue})`;

  return {
    'Hex String': `#${hexString}`,
    'RGB String': rgbString,
    Red: red,
    Green: green,
    Blue: blue
  };
});

const NameToRgbBlock = block.toJSON();
export default NameToRgbBlock;
