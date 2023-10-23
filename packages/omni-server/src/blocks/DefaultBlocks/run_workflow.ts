/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
import { type User } from 'omni-shared';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'run_workflow')
  .fromScratch()
  .set('description', 'Execute a recipe using its ID')
  .set('title', 'Run Recipe (WIP)')
  .set('category', Category.UTILITIES)
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('text', 'string', 'text')
      .set('title', 'Text')
      .set('description', 'A simple input string')
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('images', 'array', 'image', { array: true })
      .set('title', 'Images')
      .set('description', 'One or more images')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('audio', 'array', 'audio', { array: true })
      .set('title', 'Audio')
      .set('description', 'One or more audio files')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('documents', 'array', 'document', { array: true })
      .set('title', 'Documents')
      .set('description', 'One or more documents')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )
  .addInput(
    component.createInput('workflowId', 'string', 'text').set('description', 'A string').setRequired(true).toOmniIO()
  )
  .addOutput(component.createOutput('text', 'string', 'text', { array: true }).set('title', 'Text').toOmniIO())
  .addOutput(component.createOutput('images', 'array', 'image', { array: true }).set('title', 'Images').toOmniIO())
  .addOutput(component.createOutput('audio', 'array', 'audio', { array: true }).set('title', 'Audio').toOmniIO())
  .addOutput(
    component.createOutput('documents', 'array', 'document', { array: true }).set('title', 'Documents').toOmniIO()
  )
  .addOutput(component.createOutput('result', 'object').set('title', 'Result').toOmniIO())

  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    let response; // Declare 'response' at the beginning of the function

    if (payload.workflowId) {
      const workflowId = payload.workflowId;
      delete payload.workflowId;
      const wfIntegration = ctx.app.integrations.get('workflow');
      const dbService = ctx.app.services.get('db');
      const user = (await dbService.get(`user:${ctx.userId}`)) as User;
      const jobResult: { jobId: number } = await wfIntegration.startWorkflow(
        wfIntegration,
        workflowId,
        ctx.sessionId,
        user,
        payload,
        undefined,
        ctx.args.botIdentity
      );
      if (jobResult.jobId) {
        response = await new Promise((resolve, reject) => {
          ctx.app.events.once(`jobs.job_finished.${jobResult.jobId}`).then((artifacts: any) => {
            resolve(artifacts);
          });
        });
      }
    }

    if (response) {
      // const result: any = {};
      // for (const key of Object.keys(response)) {
      //   const value = response[key];
      //   if (Array.isArray(value)) {
      //     if (value.length > 0) {
      //       const itemType = typeof value[0];
      //       if (itemType === 'string') {
      //         result.text = value; // Assuming text items are strings
      //       } else if (itemType === 'object' && value[0].type === 'audio') {
      //         result.audio = value;
      //       } else if (itemType === 'object' && value[0].type === 'image') {
      //         result.images = value;
      //       } else if (itemType === 'object' && value[0].type === 'document') {
      //         result.documents = value;
      //       }
      //     }
      //   }
      // }
      return { result: response };
    } else {
      return { error: 'No result received' };
    }
  });

const RunWorkflowComponent = component.toJSON();
export default RunWorkflowComponent;
