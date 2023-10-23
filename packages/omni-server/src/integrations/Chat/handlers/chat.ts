/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type ChatService, ChatContext } from '../../../services/ChatService.js';
import { type APIIntegration } from '../../APIIntegration.js';
import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type User } from 'omni-shared';

const resolveService = function (integration: APIIntegration): ChatService {
  return integration.app.services.get('chat') as unknown as ChatService;
};

const appendToChatExport = function () {
  return {
    description: 'Get chat history',
    params: [
      { name: 'contextId', required: true, type: 'string', description: 'The chat context id' },
      { name: 'payload', required: false, type: 'object', description: 'Client compatible chat payload' }
    ]
  };
};

const appendToChatHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: {
      params: {
        type: 'object',
        properties: {
          contextId: { type: 'string' }
        },
        required: ['contextId']
      },
      body: {
        type: 'object',
        properties: {
          payload: {
            type: 'object',
            properties: {
              msgstore: { type: 'object' },
              version: { type: 'number' },
              ts: { type: 'number' }
            },
            required: ['msgstore', 'version', 'ts']
          }
        },
        required: ['payload']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'string' }
          }
        },
        400: {
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
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      const chatService = resolveService(integration);
      const contextId = (request as any)?.params?.contextId;
      const body = request.body as { payload: { msgstore: object; version: number; ts: number } };
      if (!body) {
        return reply.status(400).send({ error: 'Bad request or parameters' });
      }
      const user = request.user as User;
      chatService
        .writeAppend(user.id, contextId, body.payload, body.payload.ts)
        .then(() => {
          return reply.status(200).send({ success: 'ok' });
        })
        .catch((error) => {
          omnilog.error(error);
          return reply.status(500).send({ error: 'Unable to update chat context history' });
        });
    }
  };
};

const clearChatHistoryClientExport = function () {
  return {
    description: 'Clear chat history',
    params: [{ name: 'contextId', required: true, type: 'string', description: 'The context id' }]
  };
};

const clearChatHistoryHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: {
      params: {
        type: 'object',
        properties: {
          contextId: { type: 'string' }
        },
        required: ['contextId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'string' }
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
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      const user = request.user as User;
      const contextId = (request as any)?.params?.contextId;

      const chatService = resolveService(integration);
      chatService
        .clearChatHistory(user.id, contextId)
        .then((result) => {
          return reply.status(200).send({ success: 'ok' });
        })
        .catch((error) => {
          omnilog.error(error);
          return reply.status(500).send({ error: 'Unable to find clear context history for context ' + contextId });
        });
    }
  };
};

const getChatHistoryClientExport = function () {
  return {
    description: 'Get chat history',
    params: [
      { name: 'contextId', required: true, type: 'string', description: 'The context id' },
      {
        name: 'up_to_ts',
        required: false,
        type: 'number',
        description: 'The latest inclusive timestamp to fetch to. Defaults to NOW'
      },
      {
        name: 'length',
        required: false,
        type: 'number',
        description: 'The latest inclusive timestamp to fetch to. Defaults to 10'
      }
    ]
  };
};

const getChatHistoryHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: {
      params: {
        type: 'object',
        properties: {
          contextId: { type: 'string' }
        },
        required: ['contextId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'string' },
            result: {
              type: 'object',
              properties: {
                up_to_ts: { type: 'number' },
                result: {
                  type: 'array',
                  items: {
                    ts: { type: 'number' },
                    version: { type: 'number' },
                    msgstore: {
                      type: 'object',
                      properties: {
                        message: { type: 'string' },
                        sender: { type: 'string' },
                        workflowId: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          required: ['success', 'result']
        },
        500: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          },
          required: ['error']
        }
      }
    },
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      const user = request.user as User;
      const contextId = (request as any)?.params?.contextId;

      const chatService = resolveService(integration);
      chatService
        .getChatContext(user.id, contextId)
        .then((chatContext) => {
          return reply
            .status(200)
            .send({ success: 'ok', result: chatContext.partialGet(ChatContext.MAX_LENGTH, Date.now()) });
        })
        .catch((error) => {
          omnilog.error(error);
          return reply.status(500).send({ error: 'Unable to find chat context history for context ' + contextId });
        });
    }
  };
};

export {
  getChatHistoryHandler,
  getChatHistoryClientExport,
  appendToChatHandler,
  appendToChatExport,
  clearChatHistoryHandler,
  clearChatHistoryClientExport
};
