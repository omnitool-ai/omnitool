/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'text_template')
  .fromScratch()
  .set('description', 'Format text using templates with placeholder variables sourced from a JSON object')
  .set('title', 'Text Template')
  .set('category', Category.TEXT_MANIPULATION)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component
      .createInput('template', 'string', 'text')
      .set('title', 'Template')
      .set('description', 'A text Template')
      .setRequired(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('json', 'object')
      .set('title', 'JSON')
      .set('description', 'An input JSON object')
      .setRequired(true)
      .toOmniIO()
  )
  .addOutput(component.createOutput('template', 'text').set('title', 'JSON').set('description', 'The').toOmniIO())
  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    const { json } = payload;
    return { json };
  });
const JsonInputComponent = component.toJSON();
export default JsonInputComponent;
