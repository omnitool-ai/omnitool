/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const component = OAIBaseComponent.create('omnitool', 'run_script')
  .fromScratch()
  .set('description', 'Executes an omnitool server script with the specified arguments.')
  .set('title', 'Run Script')
  .set('category', Category.UTILITIES)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component
      .createInput('script', 'string')
      .set('title', 'Script')
      .set('description', 'A string')
      .setRequired(true)
      .toOmniIO()
  )
  .addInput(component.createInput('args', 'object').set('title', 'Args').set('description', 'Args').toOmniIO())
  .addInput(
    component
      .createInput('files', 'cdnObjectArray')
      .set('title', 'Files')
      .set('description', 'Optional Files Objects')
      .toOmniIO()
  )
  .addOutput(component.createOutput('result', 'object').set('title', 'Result').set('description', 'Object').toOmniIO())
  .addOutput(
    component
      .createOutput('files', 'cdnObjectArray')
      .set('title', 'Files')
      .set('description', 'Optional Files Objects')
      .toOmniIO()
  );
component.setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
  const integration = ctx.app.integrations.get('mercenaries');
  return await integration.runScriptFromWorkflow(ctx, payload.script, payload.args, { files: payload.files });
});
const RunScriptComponent = component.toJSON();
export default RunScriptComponent;
