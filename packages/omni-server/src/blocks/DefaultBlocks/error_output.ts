/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'output_error')
  .fromScratch()
  .set('description', 'View errors.')
  .set('title', 'Error Viewer')
  .set('category', Category.UTILITIES)
  .setMethod('X-PASSTHROUGH');
component.addOutput(component.createOutput('error', 'error').set('description', 'An Error').toOmniIO());
component.setMeta({
  source: {
    summary: 'A standard text input component',
    authors: ['Mercenaries.ai Team'],
    links: {
      'Mercenaries.ai': 'https://mercenaries.ai'
    }
  }
});
const controlComposer = component.createControl('errorViewer');

controlComposer.setControlType('AlpineTextComponent');
// TODO: add this back in when figure out the way to set the value
// .set('displays', 'input:error')
// .set('opts', { readonly: true })

component.addControl(controlComposer.toOmniControl());
const ErrorOutputComponent = component.toJSON();
export default ErrorOutputComponent;
