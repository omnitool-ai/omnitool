/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Text Replacer: Perform string replacement on input text
// --------------------------------------------------------------------------

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'text_replace')
  .fromScratch()
  .set(
    'description',
    `Replace specified text within the input text. Provide the input text, the text to be matched, and the text to replace the matched term(s) with. For example:

    **Input**: PRODUCT is awesome
    **Match**: PRODUCT
    **Replace**: Omnitool
  `
  )
  .set('title', 'Text Replacer')
  .set('category', Category.TEXT_MANIPULATION)
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('text', 'string', 'text' /*socket type*/)
      .set('description', 'The input text')
      .setRequired(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('match', 'string', 'text')
      .set('description', 'The text to be matched, or a regular expression in the form /regex/flags (e.g. /foo/g) ')
      .setRequired(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('replace', 'string', 'text')
      .set('description', 'Text to replace the matched term(s) with')
      .setRequired(true)
      .toOmniIO()
  )

  .addOutput(component.createOutput('text', 'string', 'text').set('description', 'A string').toOmniIO())

  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    let { match, replace } = payload;

    if (!match || replace === null) {
      return { text: payload.text }; // pass-through
    }
    replace = replace.trim();
    let text = payload.text;
    const useRegex = match.indexOf('/') === 0;
    if (useRegex) {
      const matchParts = match.split('/');
      const regex = new RegExp(matchParts[1], matchParts[2] || 'g');
      text = text.replace(regex, replace);
    } else {
      text = text.replace(match, replace);
    }
    return { text };
  });

const TextReplacerComponent = component.toJSON();

export default TextReplacerComponent;
