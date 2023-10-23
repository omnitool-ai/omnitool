/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// runscript.ts
//
//  Purpose:  Provides a simple script runner API
//
//  Usage: 1. Put scripts into the server script folder
//         2. Invoke the post API
// ---------------------------------------------------------------------------------------------

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type MercsDefaultIntegration } from '../MercsDefaultIntegration';

const runScriptClientExport = function () {
  return {
    description: 'run a script',
    params: []
  };
};

const createRunScriptHandler = function (integration: MercsDefaultIntegration, config: any) {
  return {
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const body: any = request.body;
      // @ts-ignore
      const script = request.params.script;
      if (script != null && script.trim?.() != '') {
        integration.debug('Runscript request', script, body);
        try {
          const result = await integration.runScript(request, script, body);
          return await reply.send(result);
        } catch (ex: any) {
          integration.error(ex);
          const message = ex.message || 'Unknown error';
          if (message.indexOf('ENOENT') > -1) {
            return await reply.code(404).send({ error: 'No such command' });
          }
          return await reply.code(500).send({ error: ex.message });
        }
      } else {
        return await reply.code(400).send({ error: 'Invalid script name' });
      }
    }
  };
};

export { createRunScriptHandler, runScriptClientExport };
