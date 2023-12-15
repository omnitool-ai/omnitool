/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Get Recipes
// --------------------------------------------------------------------------

import type { WorkflowIntegration } from 'integrations/WorkflowIntegration/WorkflowIntegration';
import {
  OAIBaseComponent,
  OmniComponentFlags,
  OmniComponentMacroTypes,
  type WorkerContext,
  BlockCategory as Category
} from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'get_recipes')
  .fromScratch()
  .set('title', 'Get Recipes')
  .set('category', Category.INPUT_OUTPUT)
  .set(
    'description',
    `Receive data (text, images, audio, video, and documents) directly from the chat window, transforming the recipe into a simple chatbot.
    Text, images, audio, video and documents are supplied via chat by typing and/or uploading.
    The JSON output is automatically populated if the text is valid JSON.
  `
  )
  .setMethod('X-CUSTOM');

component
  .addOutput(component.createOutput('models', 'object', undefined, {array: true}).set('title', 'Models').toOmniIO())
  .setMacro(OmniComponentMacroTypes.EXEC, processPayload);

enum OMNITOOL_DOCUMENT_TYPES {
  WORKFLOW = 'wf',
  USER = 'user',
  USERDOC = 'udoc',
  CHAT = 'chat',
  GROUP = 'Group'
}
  
async function processPayload(payload: any, ctx: WorkerContext) 
{
  const user_id = ctx.userId;
  const user_ids = [user_id];
  const integration: WorkflowIntegration = ctx.app.integrations.get('workflow');
  const collection = await integration.db.getDocumentsByOwnerIdV2(OMNITOOL_DOCUMENT_TYPES.WORKFLOW, user_ids, 0, 100);

  const items = collection.docs;
  const models = [];
  models.push({title:"Select a recipe", value:"invalid"});

  for (const workflow of items) 
  {
    const id = workflow.id;
    const name = workflow.meta?.name;
    models.push({title:name, value:id});
    
  }
  const results = { models , "ok":true };
  return results;
}

export const GetRecipesComponent = component.toJSON();
