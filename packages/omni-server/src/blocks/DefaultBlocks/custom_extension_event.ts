/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OmniSSEMessages, type IOmniSSEMessageCustomExtensionEvent } from 'omni-shared';

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const component = OAIBaseComponent.create('omnitool', 'custom_extension_event_client')
  .fromScratch()
  .set(
    'description',
    'Sends a custom extension event to a client extension (which must be open to receive it). This block can be used to let the server trigger events in an extension window on the client'
  )
  .set('title', 'Custom Extension Event (Client)')
  .set('category', Category.UTILITIES)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component
      .createInput('extensionId', 'string')
      .set('title', 'Extension Id')
      .set('description', 'The ID of the extension to notify (e.g. omni-extension-babylonjs)')
      .setRequired(true)
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('eventId', 'string')
      .set('title', 'Event Id')
      .set('description', 'The custom eventId to send to the extension.')
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('eventArgs', 'object', 'json')
      .set('title', 'Event Arg')
      .set('description', 'Event Argument')
      .toOmniIO()
  );

component.setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
  let { extensionId, eventId, eventArgs } = payload;

  if (!extensionId) throw new Error('Extension Id Required');
  if (!eventId) throw new Error('EventId required');

  if (eventArgs && typeof eventArgs === 'string') {
    eventArgs = JSON.parse(eventArgs);
  }

  const message: IOmniSSEMessageCustomExtensionEvent = {
    type: OmniSSEMessages.CUSTOM_EXTENSION_EVENT,
    body: {
      extensionId,
      eventId,
      eventArgs
    }
  };

  await ctx.app.io.send(ctx.sessionId, message);

  return {};
});

const CustomExtensionEventClientComponent = component.toJSON();
export default CustomExtensionEventClientComponent;
