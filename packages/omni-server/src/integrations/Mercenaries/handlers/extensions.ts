/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import type MercsServer from 'core/Server';
import { type APIIntegration } from '../../APIIntegration';
import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type ServerExtension } from 'core/ServerExtensionsManager';

// This is the server function. When running a workflow on the server, we just call this.
const getExtensions = function (integration: APIIntegration): any {
  const app = integration.app as MercsServer;

  const extensions = app.extensions.all().map((extension: ServerExtension) => {
    const config = extension.extensionConfig;

    return {
      id: config.id,
      description: config.description,
      title: config.title,
      scripts: {
        client: config.scripts?.client
      },
      blocks: config.blocks,
      patches: config.patches,
      errors: extension.errors,
      ...(config.client || {})
    };
  });

  return extensions;
};

const createGetExtensionHandler = function (integration: APIIntegration, config: any) {
  return {
    // schema: {
    //   response: {
    //     200: {
    //       type: 'array',
    //       items: {
    //         type: 'object',
    //         properties: {
    //           id: { type: 'string' },
    //           description: { type: 'string' },
    //           title: { type: 'string' },
    //           scripts: { type: 'object' },
    //           blocks: {
    //             type: 'array',
    //             items: {
    //               type: 'object',
    //             },
    //           },
    //           patches: {
    //             type: 'array',
    //             items: {
    //               type: 'object',
    //             }
    //           },
    //           errors: {
    //             type: 'array',
    //             items: {
    //               type: 'object',
    //             }
    //           },
    //           addToWorkbench: { type: 'boolean' },
    //           singleton: { type: 'boolean' },
    //           winbox: { type: 'object' },
    //         }
    //       }
    //     }
    //   }
    // },
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      let body = request.body || {};
      integration.debug('Ping request', body);
      body = getExtensions(integration);
      return reply.send(body);
    }
  };
};

export { createGetExtensionHandler };
