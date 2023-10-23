/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
import levenshtein from 'js-levenshtein';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'comparison')
  .fromScratch()
  .set('description', 'Compare two texts for various types of equality, including optional Levenshtein Distance.')
  .set('title', 'Text Comparison')
  .set('category', Category.TEXT_MANIPULATION)
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('textA', 'string', 'text')
      .set('title', 'Text A')
      .set('description', 'A JSON string')
      .setRequired(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('textB', 'string', 'text')
      .set('title', 'Text B')
      .set('description', 'A JSON string')
      .setRequired(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('caseSensitive', 'boolean')
      .set('title', 'Case Sensitive')
      .set('description', 'Should the comparison be case sensitive?')
      .setDefault(false)
      .toOmniIO()
  )
  .addOutput(component.createOutput('equal', 'boolean').set('description', 'Are the two texts equal?').toOmniIO())
  .addOutput(
    component.createOutput('notEqual', 'boolean').set('description', 'Are the two texts not equal?').toOmniIO()
  );

component.setMeta({
  source: {
    summary: 'Compare two texts for equality, including optional Levenshtein Distance.',
    links: {
      'Levenshtein Module': 'https://github.com/gustf/js-levenshtein'
    }
  }
});

component.setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
  const { textA, textB } = payload;
  let equal = false;
  if (payload.caseSensitive) {
    equal = textA === textB;
  } else {
    equal = textA.toLowerCase() === textB.toLowerCase();
  }
  const contains = textA.includes(textB);
  const startsWith = textA.startsWith(textB);
  const notEqual = !equal;
  let lvd = 0;
  if (notEqual) {
    lvd = levenshtein(textA, textB);
  }
  const lengthDifference = textA.length - textB.length;
  return {
    equal,
    notEqual,
    levenshtein: lvd,
    contains,
    startsWith,
    lengthDifference
  };
});

const TextComparisonComponent = component.toJSON();

export default TextComparisonComponent;
