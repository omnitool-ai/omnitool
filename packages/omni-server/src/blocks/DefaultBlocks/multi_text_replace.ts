/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
const component = OAIBaseComponent.create('omnitool', 'multi_text_replace')
  .fromScratch()
  .set(
    'description',
    'Perform dynamic text formatting using templates with variable placeholders, like **{INPUT:Variable Name}** or **{IMAGE:Source Image}**, for inserting text and images. After saving, this block automatically generates input sockets. You can retrieve images using **{IMAGE:filename}**, with filenames set by the **Set File Metadata** block.'
  )
  .set('title', 'Text Template')
  .set('category', Category.TEXT_MANIPULATION)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component
      .createInput('source', 'string')
      .set('title', 'Template')
      .set(
        'description',
        'The string to perform replacements on, containing template variables in the form of {VARIABLE_NAME}'
      )
      .setRequired(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('replace', 'object')
      .set('title', 'JSON Object')
      .set('description', 'A JSON object containing key-value pairs to replace in the source string')
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('images', 'object', 'image', { array: true })
      .set('title', 'Images')
      .set(
        'description',
        'any images you want to replace, inserted into the text in the form of {IMAGE:filename} (use the Set File Metadata block to set) or using their index {{IMAGE:0}} in the passed array. Note that indices are often unstable.'
      )
      .allowMultiple(true)
      .toOmniIO()
  )

  .addControl(
    component
      .createControl('button')
      .set('title', 'Save')
      .setControlType('AlpineButtonComponent')
      .setCustom('buttonAction', 'script')
      .setCustom('buttonValue', 'save')
      .set('description', 'Save')
      .toOmniControl()
  )
  .addOutput(
    component.createOutput('text', 'string').set('description', 'The source string with replacements made').toOmniIO()
  )

  .setMacro(OmniComponentMacroTypes.ON_SAVE, async (node: any) => {
    const source = node.data.source;
    const customInputs = JSON.stringify(node.data['x-omni-dynamicInputs']);

    //regexp to find any dynamic inputs in the text in the form of {input:name} where name is alphanumeric, no spaces
    const regex = /{input:([^}]+)}/gi;

    //const regex = /{input:([^}]+)}/gi
    const matches = source.matchAll(regex);
    const inputs = [...matches].map((match) => {
      return {
        title: match[1],
        name: match[1].toLowerCase().replace(/[^a-z0-9]/g, '_'),
        type: 'string',
        customSocket: 'text'
      };
    });

    // turn this into an object name: object
    const inputsObject: any = {};
    inputs.forEach((input: any) => {
      inputsObject[input.name] = input;
    });

    node.data['x-omni-dynamicInputs'] = inputsObject;

    return true;
  })

  .setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
    const { source, replace } = payload;
    let text = source;
    if (replace) {
      for (const [key, value] of Object.entries(replace)) {
        const search = key;
        const regex = new RegExp('{' + search.toUpperCase() + '}', 'g');
        text = text.replace(regex, value);
      }
    }

    if (Object.keys(ctx.node.data['x-omni-dynamicInputs'] || {}).length) {
      for (const key in ctx.node.data['x-omni-dynamicInputs'] || {}) {
        const term = ctx.node.data['x-omni-dynamicInputs'][key].title;
        const search = '{input:' + term + '}';
        const regex = new RegExp(search, 'gi');
        text = text.replace(regex, payload[key]);
      }
    }

    if (payload.images?.length) {
      for (let i = 0; i < payload.images.length; i++) {
        const fileName = payload.images[i].fileName.toLowerCase().trim();

        const search = '{IMAGE:' + fileName + '}';
        const regex = new RegExp(search, 'g');
        text = text.replace(regex, '/fid/' + payload.images[i].fid);

        const search2 = '{IMAGE:' + i.toString().toLocaleLowerCase().trim() + '}';
        const regex2 = new RegExp(search2, 'g');
        text = text.replace(regex2, '/fid/' + payload.images[i].fid);
      }

      const search = '{IMAGES_MARKDOWN}';
      const regex = new RegExp(search, 'g');
      text = text.replace(
        regex,
        payload.images.map((image: any) => {
          return `![/fid/${image.fileName}](/fid/${image.fid})`;
        })
      );
    }

    return { text };
  });
const MultiTextReplacerComponent = component.toJSON();
export default MultiTextReplacerComponent;
