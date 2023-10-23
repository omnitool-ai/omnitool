/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Text to JSON Converter: Convert text to JSON object or array.
// --------------------------------------------------------------------------

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'text_to_json')
  .fromScratch()
  .set('description', 'Convert text into a JSON object or array, allowing for additional manipulation.')
  .set('title', 'Text to JSON Converter')
  .set('category', Category.DATA_TRANSFORMATION)
  .setMethod('X-CUSTOM');

component
  .addInput(component.createInput('text', 'string', 'text').set('description', 'A JSON string').toOmniIO())

  .addOutput(
    component.createOutput('json', 'object').set('description', 'the resulting JSON').set('title', 'JSON').toOmniIO()
  )

  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    const text = payload.text;
    let json;
    if (text != null) {
      try {
        json = JSON.parse(text);
      } catch {
        // eslint-disable-next-line no-control-regex
        let sanitizedText = text.trim().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        // Remove new lines ('\n')
        sanitizedText = sanitizedText.replace(/\n/g, '');
        // Remove literal \n characters
        sanitizedText = sanitizedText.replace(/\\n/g, ' ');
        // Remove literal \t characters
        sanitizedText = sanitizedText.replace(/\\t/g, ' ');
        // Remove literal \r characters
        sanitizedText = sanitizedText.replace(/\\r/g, ' ');

        try {
          json = JSON.parse(sanitizedText);
        } catch (error: any) {
          const errorText = `Invalid JSON string: ${sanitizedText}. Error: ${error.message}`;
          throw new Error(errorText);
        }
      }
    } else {
      throw new Error('Payload text is null or undefined.');
    }

    return { json };
  });
const TextToJSONComponent = component.toJSON();

export default TextToJSONComponent;
