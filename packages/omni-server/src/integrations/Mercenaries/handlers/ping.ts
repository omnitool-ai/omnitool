/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// ping.ts
//
//  Purpose:  A simple ping handler
//
// ---------------------------------------------------------------------------------------------

import { type APIIntegration } from '../../APIIntegration';
import { type FastifyRequest, type FastifyReply } from 'fastify';

const pingClientExport = function () {
  return {
    description: 'Ping the server',
    params: []
  };
};

// This is the server function. When running a workflow on the server, we just call this.
const ping = function (payload: any) {
  return { ping: 'pong', payload: payload || {} };
};

const createPingHandler = function (integration: APIIntegration, config: any) {
  return {
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      let body = request.body || {};
      integration.debug('Ping request', body);
      body = ping(body);
      return reply.send(body);
    }
  };
};

export { createPingHandler, pingClientExport, ping };
