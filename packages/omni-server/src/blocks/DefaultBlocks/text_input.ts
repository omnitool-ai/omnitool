/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Text Input: A standard text input component
// --------------------------------------------------------------------------

import { OAIBaseComponent, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'input_text')
  .fromScratch()
  .set(
    'description',
    'Accept text values as input. It also comes with built-in URL fetching capabilities, enabling convenient connections of your file to the Image/Audio/Document sockets.'
  )
  .set('title', 'Text Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-PASSTHROUGH');

component
  .addInput(
    component
      .createInput('text', 'string', 'text', { array: true })
      .set('description', 'A string')
      .allowMultiple(true)
      .toOmniIO()
  )

  .addOutput(component.createOutput('text', 'string', 'text').set('description', 'A string').toOmniIO())

  .setMeta({
    source: {
      summary:
        'A standard text input component with built-in URL fetching, enabling it to be connected to File (Image/Audio/Document) sockets',
      authors: ['Mercenaries.ai Team'],
      links: {
        'Mercenaries.ai': 'https://mercenaries.ai'
      }
    }
  });

const TextInputComponent = component.toJSON();

export default TextInputComponent;
