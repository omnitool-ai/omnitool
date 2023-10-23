/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// integrations.ts
//
//  Purpose:  Provides a default API integration for Mercenaries functions
//
//  Usage: 1. In integration's load function, add it to the handlers collection
//            this.handlers.set('ping', createPingHandler)
//         2. In mercs.yaml, declare the route mapping to it
// ---------------------------------------------------------------------------------------------

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type MercsDefaultIntegration } from '../MercsDefaultIntegration';

const createIntegrationsHandler = function (integration: MercsDefaultIntegration, config: any) {
  return {
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const body = Array.from(integration.manager.clientExports);
      return reply.send(body);
    }
  };
};

export { createIntegrationsHandler };
