/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Text Input: A standard text input component
// --------------------------------------------------------------------------

import { OAIBaseComponent, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'input_credential')
  .fromScratch()
  .set(
    'description',
    `A text input component that masks its content by default.  \n\n⚠️ WARNING: This node performs visual masking only`,

  )
  .set('title', 'Masked Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-PASSTHROUGH');

component
  .addInput(
    component
      .createInput('text', 'string')
      .set('description', 'Sensitive text you would like to mask')
      .setFormat('password')
      .allowMultiple(true)
      .toOmniIO()
  )

  .addOutput(component.createOutput('text', 'string', 'text').set('description', 'Sensitive text').toOmniIO())

  .setMeta({
    source: {

      authors: ['Mercenaries.ai Team'],
      links: {
        'Mercenaries.ai': 'https://mercenaries.ai'
      }
    }
  });

const PasswordInputComponent = component.toJSON();

export default PasswordInputComponent;
