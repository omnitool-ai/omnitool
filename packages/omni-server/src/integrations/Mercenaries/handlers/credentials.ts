/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import type MercsServer from 'core/Server';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type OmniAPIKey, type OmniNamespaceDefinition } from 'omni-sockets/src/components/openapi/types';
import { User, omnilog } from 'omni-shared';
import { type CredentialService } from 'services/CredentialsService/CredentialService';
import { type APIIntegration } from '../../APIIntegration';

const errorCredentialSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    error: { type: 'string' }
  },
  required: ['ok', 'error']
};

const setUserKeySchema = {
  body: {
    type: 'object',
    properties: {
      apiNamespace: { type: 'string' },
      variableName: { type: 'string' },
      credential: { type: 'string' },
      meta: { type: 'object' }
    },
    required: ['apiNamespace', 'variableName', 'credential']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' }
      }
    },
    500: errorCredentialSchema
  }
};

const bulkAddUserKeysSchema = {
  body: {
    type: 'object',
    properties: {
      keys: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            apiNamespace: { type: 'string' },
            variableName: { type: 'string' },
            credential: { type: 'string' }
          },
          required: ['apiNamespace', 'variableName', 'credential']
        }
      }
    },
    required: ['keys']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' }
      }
    },
    500: errorCredentialSchema
  }
};

const revokeUserKeySchema = {
  querystring: {
    type: 'object',
    properties: {
      apiNamespace: { type: 'string' },
      variableName: { type: 'string' }
    },
    required: ['apiNamespace', 'variableName']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        error: { type: 'string' }
      },
      required: ['ok']
    },
    500: errorCredentialSchema
  }
};

const setUserKeyClientExport = function () {
  return {
    description: 'Set user level key for an API',
    params: []
  };
};

/**
 * Handler for setting a user level key for an API
 *
 *   Sample request:
 *   {
 *     "apiNamespace": "string",
 *     "credential": {
 *       "header": {
 *         "Authorization": "Bearer <token>"
 *       }
 *     },
 *     "meta": {
 *       "name": "string",
 *       "description": "string",
 *       "revoked": true,
 *     }
 *   }
 *
 * @param integration
 * @param config
 */
const createSetUserKeyHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: setUserKeySchema,
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const { apiNamespace, variableName, credential } = request.body;

      const user: User = request.user as User;

      const credentialService = integration.app.services.get('credentials') as CredentialService;
      if (credentialService) {
        try {
          await credentialService.setUserCredential(user, apiNamespace, variableName, credential);
          await reply.code(200).send({ ok: true });
        } catch (err) {
          integration.error(err);
          await reply.code(500).send({ ok: false, error: 'Internal Server Error' });
        }
      } else {
        integration.error('CredentialService is disabled');
        await reply.code(500).send({ ok: true, error: 'Setting user credential is not supported' });
      }
    }
  };
};

/**
 * Adding multiple user keys
 *
 *   Sample request:
 *   { "keys": [{
 *       "apiNamespace": "string",
 *       "credential": "string",
 *       "meta": {
 *          "name": "string",
 *          "description": "string",
 *          "revoked": true,
 *       },
 *     },
 *     {
 *      ...
 *     }]
 *  }
 *
 * @param integration
 * @param config
 */
const bulkSetUserKeysHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: bulkAddUserKeysSchema,
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const { keys } = request.body || {};

      const user: User = request.user as User;

      const credentialService = integration.app.services.get('credentials') as CredentialService;
      if (credentialService) {
        if (Array.isArray(keys)) {
          for (const k of keys) {
            try {
              omnilog.debug('bulkSetUserKeysHandler', k);
              await credentialService.setUserCredential(user, k.apiNamespace, k.variableName, k.credential);
            } catch (err) {
              integration.error(err);
            }
          }
        }
        await reply.code(200).send({ ok: true });
      } else {
        integration.error('CredentialService is disabled');
        await reply.code(500).send({ ok: true, error: 'Setting user credential is not supported' });
      }
    }
  };
};

const revokeUserKeyClientExport = function () {
  return {
    description: 'Revoke user level key for an API',
    params: []
  };
};

/**
 * Handler for revoking a user level key for an API
 *
 *
 * @param integration
 * @param config
 */
const createRevokeUserKeyHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: revokeUserKeySchema,
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const apiNamespace = request.query.apiNamespace;
      // @ts-ignore
      const variableName = request.query.variableName;
      const user: User = request.user as User;

      const credentialService = integration.app.services.get('credentials') as CredentialService;
      if (credentialService) {
        try {
          if (await credentialService.revokeUserCredentials(user, apiNamespace, variableName)) {
            await reply.code(200).send({ ok: true });
          } else {
            await reply.code(200).send({ ok: false, error: 'Failed to revoke key' });
          }
        } catch (err) {
          integration.error(err);
          await reply.code(500).send({ ok: false, error: 'Internal Server Error' });
        }
      } else {
        integration.error('CredentialService is disabled');
        await reply.code(500).send({ ok: true, error: 'User credential is not supported' });
      }
    }
  };
};

const listUserKeysClientExport = function () {
  return {
    description: 'List user level keys for an API',
    params: []
  };
};

const createListUserKeysHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            keys: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  meta: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      revoked: { type: 'boolean' }
                    }
                  },
                  apiNamespace: { type: 'string' },
                  tokenType: { type: 'string' },
                  owner: { type: 'string' }
                }
              }
            }
          },
          required: ['ok', 'keys']
        },
        500: errorCredentialSchema
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;

      const credentialService = integration.app.services.get('credentials') as CredentialService;
      if (credentialService) {
        try {
          const keys = await credentialService.listKeyMetadata(user.id, User.modelName);
          await reply.code(200).send({ ok: true, keys });
        } catch (err) {
          integration.error(err);
          await reply.code(500).send({ ok: false, error: 'Internal Server Error' });
        }
      } else {
        integration.error('CredentialService is disabled');
        await reply.code(500).send({ ok: true, error: 'User credential is not supported' });
      }
    }
  };
};

const getRequiredKeysClientExport = function () {
  return {
    description: 'Get all required keys for installed API',
    params: []
  };
};

const createGetRequiredKeysHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            requiredCredentials: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  displayName: { type: 'string' },
                  credential: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        displayName: { type: 'string' },
                        type: { type: 'string', enum: ['apiKey', 'oauth2'] },
                        hasKey: { type: 'boolean' }
                      }
                    }
                  }
                },
                required: ['id', 'displayName', 'credential']
              }
            }
          },
          required: ['ok', 'requiredCredentials']
        },
        500: errorCredentialSchema
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        const user: User = request.user as User;
        const credentialService = integration.app.services.get('credentials') as CredentialService;
        const keys = await credentialService.listKeyMetadata(user.id, User.modelName);

        const blockManager = (integration.app as MercsServer).blocks;
        const namespaces = blockManager.getAllNamespaces();
        const requiredCredentials: Record<string, { id: string; displayName: string; credential: any }> = {};
        await Promise.all(
          namespaces.map(async (namespace: OmniNamespaceDefinition) => {
            try {
              const requiredCredentialsForNamespace = blockManager.getRequiredCredentials(namespace.namespace);
              requiredCredentialsForNamespace.forEach((item: OmniAPIKey) => {
                // @ts-ignore
                item.hasKey = keys.some((key: any) => {
                  return key.apiNamespace === namespace.namespace && key.tokenType === item.id;
                });
              });

              // Check if required credentials is empty
              if (!requiredCredentialsForNamespace || Object.keys(requiredCredentialsForNamespace).length === 0) {
                return;
              }

              requiredCredentials[namespace.namespace] = {
                id: `${namespace.namespace}${namespace.version ? '@' + namespace.version : ''}`,
                displayName: namespace.title ?? namespace.namespace,
                credential: requiredCredentialsForNamespace
              };
            } catch (err) {
              integration.error(err);
            }
          })
        );

        await reply.code(200).send({ ok: true, requiredCredentials });
      } catch (err) {
        integration.error(err);
        await reply.code(500).send({ ok: false, error: 'Internal Server Error' });
      }
    }
  };
};

export {
  createGetRequiredKeysHandler,
  createListUserKeysHandler,
  createRevokeUserKeyHandler,
  createSetUserKeyHandler,
  getRequiredKeysClientExport,
  listUserKeysClientExport,
  revokeUserKeyClientExport,
  setUserKeyClientExport,
  bulkSetUserKeysHandler
};
