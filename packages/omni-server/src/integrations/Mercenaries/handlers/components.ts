/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// components.ts
//
//  Purpose:  List components on the server
//
// ---------------------------------------------------------------------------------------------

import type MercsServer from 'core/Server';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type User } from 'omni-shared';
import { type APIIntegration } from '../../APIIntegration';

const getComponentsClientExport = function () {
  return {
    description: 'Get available components from the server',
    params: []
  };
};

const getComponentsHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          includeDefinitions: { type: 'boolean' }
        },
        required: ['includeDefinitions']
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              flags: { type: 'number' },
              macros: {
                type: 'object',
                properties: {
                  exec: { type: 'string' },
                  save: { type: 'string' }
                }
              },
              origin: { type: 'string' },
              customData: { type: 'object' },
              displayNamespace: { type: 'string' },
              displayOperationId: { type: 'string' },
              apiNamespace: { type: 'string' },
              apiOperationId: { type: 'string' },
              responseContent: { type: 'string' },
              category: { type: 'string' },
              enabled: { type: 'boolean' },
              errors: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
              description: { type: 'string' },
              title: { type: 'string' },
              method: { type: 'string' },
              renderTemplate: { type: 'string' },
              hash: { type: 'string' },
              name: { type: 'string' },
              inputs: { type: 'object' },
              outputs: { type: 'object' },
              controls: { type: 'object' },
              meta: { type: 'object' }
            }
          }
        },
        403: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;
      const sessionId = request.session.sessionId;

      if (!user || !sessionId) {
        integration.error('User not logged in', sessionId, user);
        return await reply.status(403).send({ error: 'User not logged in' });
      }

      const body: { includeDefinitions: boolean } = Object.assign(
        { includeDefinitions: false },
        request.body,
        request.query
      );
      integration.debug('Components request', body);

      const blockManager = (integration.app as MercsServer).blocks;

      const result: any[] = await blockManager.getAllBlocks(body.includeDefinitions);
      if (result && Array.isArray(result)) {
        // Removing this for now, as rete will always filter on the client side
        // if (!user.tags?.includes('dev'))
        // {

        // }
        integration.debug('Components result', result.length);
      }

      return result;
    }
  };
};

export { getComponentsClientExport, getComponentsHandler };
