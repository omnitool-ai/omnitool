/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// login.ts
//
//  Purpose:  Handler for login function
//
// ---------------------------------------------------------------------------------------------

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type AuthIntegration } from 'integrations/Authentication/AuthIntegration';
import { type CredentialService } from 'services/CredentialsService/CredentialService';

const oauth2Handler = function (integration: AuthIntegration, config: any) {
  return {
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user = request.user;
      if (!user) {
        return await reply.code(401).send({ error: 'Unauthorized' });
      }

      // @ts-ignore
      const ns = request.query.ns;

      const vault = integration.manager.app.services.get('credentials') as CredentialService;
      const authUrl = await vault.generateAuthUrl(user, ns);

      reply.redirect(authUrl);
    },
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ns: { type: 'string' }
        },
        required: ['ns']
      },
      response: {
        '4xx': {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        '3xx': {
          type: 'string'
        }
      }
    }
  };
};

const oauth2CallbackHandler = function (integration: AuthIntegration, config: any) {
  return {
    schema: {
      params: {
        type: 'object',
        properties: {
          ns: { type: 'string' }
        },
        required: ['ns']
      },
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          scope: { type: 'string' }
        },
        required: ['code', 'scope']
      },
      response: {
        302: {
          description: 'Redirection response',
          type: 'null' // Since no body is sent on a redirect
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        500: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user = request.user;
      if (user == null) {
        return await reply.code(401).send({ error: 'Unauthorized' });
      }

      // @ts-ignore
      const ns = request.params.ns;
      // @ts-ignore
      const code = request.query.code;
      // @ts-ignore
      const scopes = request.query.scope;
      const vault = integration.manager.app.services.get('credentials') as CredentialService;
      const success = await vault.generateAccessToken(user, ns, code, scopes);

      if (success) {
        reply.redirect('/');
      } else {
        reply.code(500).send({ error: 'Failed to get access token' });
      }
    }
  };
};

export { oauth2Handler, oauth2CallbackHandler };
