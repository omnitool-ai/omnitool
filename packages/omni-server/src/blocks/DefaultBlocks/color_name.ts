/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';

import namer from 'color-namer';

const block = OAIBaseComponent.create('omnitool', 'color_name');

block
  .fromScratch()
  .set('description', 'Translate RGB value to color name.')
  .set('title', 'Color Namer')
  .set('category', Category.UTILITIES)
  .setMethod('X-CUSTOM');

block.addInput(
  block
    .createInput('RGB Color', 'string', 'text')
    .set(
      'description',
      'Input color value in various formats, e.g., #ff0000, #f00, rgb(255,0,0), rgba(255,0,0,1), hsl(0,100%,50%), hsla(0,100%,50%,1)'
    )
    .setControl({ controlType: 'AlpineLabelComponent' })
    .toOmniIO()
);

block.addOutput(block.createOutput('Color Name', 'string', 'text').toOmniIO());

block.setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
  const rgbColor = payload['RGB Color'];

  // Use the color-namer library to get the color name
  const colors = namer(rgbColor);
  const colorName = colors.basic[0].name;

  return { 'Color Name': colorName };
});

const ColorNameBlock = block.toJSON();
export default ColorNameBlock;
