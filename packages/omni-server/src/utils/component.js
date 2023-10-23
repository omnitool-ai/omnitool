/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check

// @ts-ignore
// @ts-ignore
import { OAIBaseComponent, OmniComponentMacroTypes } from 'omni-sockets';

// @ts-ignore
function generateTitle(value) {
  const title = value
    .replace(/_/g, ' ') // Replace all underscores with spaces
    // @ts-ignore
    .replace(/\b\w/g, (match) => match.toUpperCase()); // Capitalize the first letter of each word

  return title;
}

// @ts-ignore
function setComponentInputs(component, inputs) {
  // @ts-ignore
  inputs.forEach(function (input) {
    const name = input.name;
    const type = input.type;
    const customSocket = input.customSocket;
    const description = input.description;
    const default_value = input.defaultValue;
    let title = input.title;
    const choices = input.choices;
    const minimum = input.minimum;
    const maximum = input.maximum;
    const step = input.step;
    const allow_multiple = input.allowMultiple;

    if (!title || title === '') title = generateTitle(name);

    component.addInput(
      component
        .createInput(name, type, customSocket)
        .set('title', title || '')
        .set('description', description || '')
        .set('choices', choices || null)
        .set('minimum', minimum || null)
        .set('maximum', maximum || null)
        .set('step', step || null)
        .set('allowMultiple', allow_multiple || null)
        .setDefault(default_value)
        .toOmniIO()
    );
  });
  return component;
}

// @ts-ignore
function setComponentOutputs(component, outputs) {
  // @ts-ignore
  outputs.forEach(function (output) {
    const name = output.name;
    const type = output.type;
    const customSocket = output.customSocket;
    const description = output.description;
    let title = output.title;

    if (!title || title === '') title = generateTitle(name);

    component.addOutput(
      component
        .createOutput(name, type, customSocket)
        .set('title', title || '')
        .set('description', description || '')
        .toOmniIO()
    );
  });
  return component;
}

// @ts-ignore
function setComponentControls(component, controls) {
  // @ts-ignore
  controls.forEach(function (control) {
    const name = control.name;
    let title = control.title;
    const placeholder = control.placeholder;
    const description = control.description;

    if (!title || title === '') title = generateTitle(name);

    component.addControl(
      component
        .createControl(name)
        .set('title', title || '')
        .set('placeholder', placeholder || '')
        .set('description', description || '')
        .toOmniControl()
    );
  });
  return component;
}

function createComponent(
  // @ts-ignore
  group_id,
  // @ts-ignore
  id,
  // @ts-ignore
  title,
  // @ts-ignore
  category,
  // @ts-ignore
  description,
  // @ts-ignore
  summary,
  // @ts-ignore
  links,
  // @ts-ignore
  inputs,
  // @ts-ignore
  outputs,
  // @ts-ignore
  controls,
  // @ts-ignore
  payloadParser
) {
  if (!links) links = {};

  let baseComponent = OAIBaseComponent.create(group_id, id)
    .fromScratch()
    .set('title', title)
    .set('category', category)
    .set('description', description)
    .setMethod('X-CUSTOM')
    .setMeta({
      source: {
        summary,
        links
      }
    });

  baseComponent = setComponentInputs(baseComponent, inputs);
  baseComponent = setComponentOutputs(baseComponent, outputs);
  if (controls) baseComponent = setComponentControls(baseComponent, controls);
  baseComponent.setMacro(OmniComponentMacroTypes.EXEC, payloadParser);

  const component = baseComponent.toJSON();
  return component;
}

export { createComponent, setComponentInputs, setComponentOutputs, setComponentControls };
