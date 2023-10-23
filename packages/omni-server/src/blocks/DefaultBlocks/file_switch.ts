/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Text Input: A standard text input component
// --------------------------------------------------------------------------

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'file_switch')
  .fromScratch()
  .set(
    'description',
    'Toggle the flow of files based on a switch. Enable or disable features by controlling the output of files when the switch is on or off.'
  )
  .set('title', 'File Switch Box')
  .set('category', Category.UTILITIES)
  .setMethod('X-CUSTOM');

component.addInput(
  // We are not manipulating any data in this block, so we set the customSettings.do_no_return_data to true
  component
    .createInput('files', 'array', 'file', { array: true, customSettings: { do_no_return_data: true } })
    .set('title', 'Files')
    .set('description', 'A file array')
    .allowMultiple(true)
    .toOmniIO()
);

component
  .addInput(
    component
      .createInput('switch', 'boolean', 'boolean')
      .set('description', 'Switch (on/off)')

      .toOmniIO()
  )

  .addOutput(
    component
      .createOutput('on', 'array', 'file', { array: true })
      .set('description', 'Files will leave through this output when the switch is on')
      .toOmniIO()
  )

  .addOutput(
    component
      .createOutput('off', 'array', 'file', { array: true })
      .set('description', 'Files will leave through this output when the switch is on')
      .toOmniIO()
  )

  .addOutput(
    component.createOutput('switch', 'boolean').set('description', 'Passthrough of the switch signal').toOmniIO()
  )

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

component.setMacro(OmniComponentMacroTypes.EXEC, (payload: any, ctx: WorkerContext) => {
  const files = payload.files;
  const on = payload.switch;
  if (!files) {
    return {};
  }
  console.log('File Switch: ', on, files);

  if (on === true) {
    return { on: files, switch: on };
  } else {
    return { off: files, switch: on };
  }
});

const FileSwitchComponent = component.toJSON();

export default FileSwitchComponent;
