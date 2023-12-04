/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Chat Input
// --------------------------------------------------------------------------

import {
  OAIBaseComponent,
  OmniComponentFlags,
  OmniComponentMacroTypes,
  type WorkerContext,
  BlockCategory as Category
} from 'omni-sockets';
import { type Workflow } from 'omni-shared';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'chat_input')
  .fromScratch()
  .set('title', 'Chat Input')
  .set('category', Category.INPUT_OUTPUT)
  .setFlag(OmniComponentFlags.UNIQUE_PER_WORKFLOW, true)
  .set(
    'description',
    `Receive data (text, images, audio, video, and documents) directly from the chat window, transforming the recipe into a simple chatbot.
    Text, images, audio, video and documents are supplied via chat by typing and/or uploading.
    The JSON output is automatically populated if the text is valid JSON.
  `
  )
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('text', 'string', 'text')
      .set('title', 'Text')
      .set('description', 'An input string')
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('images', 'array', 'image')
      .set('title', 'Images')
      .set('description', 'One or more images')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('audio', 'array', 'audioArray')
      .set('title', 'Audio')
      .set('description', 'One or more audio files')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('video', 'array', 'videoArray')
      .set('title', 'Video')
      .set('description', 'One or more videos')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('documents', 'array', 'documentArray')
      .set('title', 'Documents')
      .set('description', 'One or more documents')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('json', 'array', 'objectArray')
      .set('title', 'JSON Object(s)')
      .set('description', 'One or more object')
      .toOmniIO()
  )
  .addOutput(component.createOutput('text', 'string', 'text').set('title', 'Text').toOmniIO())
  .addOutput(component.createOutput('images', 'array', 'imageArray').set('title', 'Images').toOmniIO())
  .addOutput(component.createOutput('audio', 'array', 'audioArray').set('title', 'Audio').toOmniIO())
  .addOutput(component.createOutput('video', 'array', 'videoArray').set('title', 'Video').toOmniIO())
  .addOutput(component.createOutput('documents', 'array', 'documentArray').set('title', 'Documents').toOmniIO())
  .addOutput(
    component.createOutput('json', 'array', 'object', { array: true }).set('title', 'JSON Object(s)').toOmniIO()
  )

  .setMacro(OmniComponentMacroTypes.ON_SAVE, async (node: any, recipe: Workflow) => {
    recipe.ui ??= {};
    recipe.ui.chat = {
      enabled: true
    };

    return true;
  })

  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    const input = Object.assign({}, payload || {}, ctx.args);
    const input_json = input.json;
    let json;
    if (input_json) 
    {
      json = input_json;
    }
    else
    {
      try {
        json = JSON.parse(input.text); // Check if JSON
      } catch (e) {}
    }

    if (typeof json === 'object' && !Array.isArray(json)) {
      json = [json];
    }
    await ctx.app.emit('component:x-input', input);
    return { ...input, json }; // Include JSON output if possible
  });

const ChatInputComponent = component.toJSON();

export default ChatInputComponent;
