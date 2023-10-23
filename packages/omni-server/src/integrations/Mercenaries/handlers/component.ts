/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// component.ts
//
//  Purpose:  Executes a workflow sent from the client
//
// ---------------------------------------------------------------------------------------------

import type MercsServer from 'core/Server';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type APIIntegration } from '../../APIIntegration';

const addEditPatchComponentClientExport = function () {
  return {
    description: 'add/remove/edit components',
    params: []
  };
};

const addEditPatchComponent = async function (integration: APIIntegration, action: any) {
  const blockManager = (integration.app as MercsServer).blocks;
  if (!blockManager) {
    throw new Error('BlockManager Missing');
  }

  if (action.type === 'add') {
    const key = `${action.config?.create?.namespace ?? ''}.${action.config?.create?.componentKey ?? ''}`;
    return await blockManager.getInstance(key);
  }

  return { error: 'Unknown action' };
};

const addEditPatchComponentHandler = function (integration: APIIntegration, config: any) {
  return {
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const body = Object.assign({}, request.body);
      integration.debug('addComponent', body);

      let result = null;

      try {
        result = addEditPatchComponent(integration, body);
        integration.debug('addEditPatchComponent result', result);
        return await result;
      } catch (e) {
        integration.error('Error adding component', e);
        // @ts-ignore
        return { error: e.message };
      }
    }
  };
};

export { addEditPatchComponent, addEditPatchComponentClientExport, addEditPatchComponentHandler };
