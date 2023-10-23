/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'input_static_document');

component
  .fromScratch()
  .set('description', 'Retrieve a document from the file manager.')
  .set('title', 'Document Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-PASSTHROUGH');

component
  .addInput(
    component
      .createInput('doc', 'string', 'document', { customSettings: { do_no_return_data: true } })
      .set('title', 'Document')
      .set('description', 'the document fid')
      .setRequired(true)
      .toOmniIO()
  )
  .addOutput(
    component
      .createOutput('doc', 'object', 'document')
      .set('title', 'Document')
      .set('description', 'The Document')
      .toOmniIO()
  );

const StaticDocumentComponent = component.toJSON();
export default StaticDocumentComponent;
