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
import { type User } from 'omni-shared';
import { loadUserPermission, PermissionChecker, setAcceptedTOS } from '../../../helper/permission.js';

const createAcceptTOSHandler = function (integration: AuthIntegration, config: any) {
  return {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            tosAccepted: { type: 'string' }
          }
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;
      user.tosAccepted = await setAcceptedTOS(integration.db, user);
      //omnilog.debug('User accepted TOS ' + user.tosAccepted);
      if (user) {
        return await reply.send({ username: user.username, tosAccepted: user.tosAccepted });
      }

      return await reply.code(200).send();
    }
  };
};

const createGetAuthenticatedUserHandler = function (integration: AuthIntegration, config: any) {
  return {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            isAdmin: { type: 'boolean' },
            tosAccepted: { type: 'string' }
          }
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;
      if (user) {
        // @ts-ignore
        const ability = request.session.get('permission');
        if (ability == null) {
          // @ts-ignore
          request.session.set('permission', await loadUserPermission(integration.db, user));
        }
        return await reply.send({
          username: user.username,
          isAdmin: await integration.isAdmin(user),
          tosAccepted: user.tosAccepted
        });
      }

      return await reply.code(200).send();
    }
  };
};

const createLoginHandler = function (integration: AuthIntegration, config: any) {
  return {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            isAdmin: { type: 'boolean' },
            tosAccepted: { type: 'string' }
          }
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user = request.user as User;
      await integration.login(request);
      // @ts-ignore
      await reply.send({
        username: user.username,
        isAdmin: await integration.isAdmin(user),
        tosAccepted: user.tosAccepted
      });
    }
  };
};

const createLogoutHandler = function (config: any) {
  return {
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        // request.logOut()
        await request.session.destroy();
      } catch (err) {
        return await reply.send(err);
      }
    }
  };
};

/**
 * Request body:
 * {
 *  scopes: [
 *   {
 *     action: 'execute',
 *     subject: 'workflow',
 *     workflowIds: ['workflowId1', 'workflowId2']
 *   },
 *  ],
 *  expiresIn: 3600
 * }
 */
const createGenerateTokenHandler = function (integration: AuthIntegration, config: any) {
  return {
    schema: {
      body: {
        type: 'object',
        required: ['scopes', 'expiresIn'],
        properties: {
          scopes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['action', 'subject'],
              properties: {
                action: { type: 'string' },
                subject: { type: 'string' },
                orgId: { type: 'string' },
                workflowIds: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          },
          expiresIn: { type: 'number' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' }
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
      // @ts-ignore
      const { scopes, expiresIn } = request.body || {};

      try {
        if (integration.app.settings.get('omni:feature.permission')?.value) {
          // @ts-ignore
          const ability = new PermissionChecker(request.session.get('permission'));
          if (!ability) {
            throw new Error('Action not permitted');
          }
          // Scope will be either:
          // 1. Execute a workflow
          // 2. Adding user to an org

          for (const scope of scopes) {
            const { action, subject, orgId, workflowIds } = scope;

            // Requested scope should match the user's permission
            if (!ability.can(action, subject)) {
              integration.debug('Action not permitted: ', action, subject);
              throw new Error('Action not permitted');
            }
          }
        }

        // @ts-ignore
        const user = request.user as User;
        const token = await integration.generateJwtToken(scopes, user, expiresIn);
        return await reply.code(200).send({ token });
      } catch (err) {
        integration.error('Error generating token: ', err);
        return await reply.code(500).send('Internal error');
      }
    }
  };
};

export {
  createGetAuthenticatedUserHandler,
  createLoginHandler,
  createLogoutHandler,
  createGenerateTokenHandler,
  createAcceptTOSHandler
};
