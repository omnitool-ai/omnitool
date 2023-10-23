/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// sse.ts
//
//  Purpose:  Creates an SSE event stream subscription handler
//
// ---------------------------------------------------------------------------------------------

import { type User } from 'omni-shared';
import { type APIIntegration } from '../../APIIntegration';
import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type MessagingServerService } from 'services/MessagingService';

const createListenHandler = function (integration: APIIntegration, config: any) {
  // Important: Handler cannot be async or it'll break stuff
  return {
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;
      const sessionId = request.session.sessionId;

      if (!user || !sessionId) {
        integration.error('SSE: User not logged in', sessionId, user);
        return reply.status(403).send({ error: 'User not logged in' });
      }

      try {
        const messagingService = integration.app.services.get('messaging') as unknown as MessagingServerService;
        messagingService.onConnectionCreate(request, reply);
      } catch (ex) {
        integration.error('SSE: Error creating connection', ex);
        return reply.status(500).send({ error: 'Error creating connection' });
      }
    }
  };
};

export { createListenHandler };
