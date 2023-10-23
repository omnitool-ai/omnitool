/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
//  workflow.ts
//
//  Purpose:  Get / Delete / List / Update / Clone workflows
// ---------------------------------------------------------------------------------------------

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { EObjectAction, EObjectName, type User, Workflow, type IWorkflowMeta } from 'omni-shared';
import { type WorkflowIntegration } from '../WorkflowIntegration';
import { PermissionChecker } from '../../../helper/permission.js';
import { add } from 'lodash-es';

const getMetaSchema = function () {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      author: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'string' },
      help: { type: 'string' },
      created: { type: 'number' },
      updated: { type: 'number' },
      pictureUrl: { type: 'string' },
      tags: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  };
};

const getRecipeSchema = function (withReteNodes = true) {
  const schema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      // version: { type: 'string' },
      _rev: { type: 'string' },
      owner: { type: 'string' },
      org: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' }
        }
      },
      meta: getMetaSchema(),
      api: {
        type: 'object',
        additionalProperties: true
      },
      ui: {
        type: 'object',
        template: {
          type: 'string'
        },
        additionalProperties: true
      }
    }
  };
  if (!withReteNodes) {
    return schema;
  }
  const schemaWithRete = {
    ...schema,
    properties: {
      ...schema.properties,
      rete: {
        type: 'object',
        // ...TODO...
        additionalProperties: true
      }
    }
  };

  return schemaWithRete;
};

const deleteWorkflowClientExport = function () {
  return {
    description: 'delete a workflow',
    params: [
      { name: 'id', required: true, type: 'string', description: 'The workflow to delete' },
      { name: '_rev', required: false, type: 'string', description: 'The current revision of the workflow' }
    ]
  };
};

// Deletes a workflow for the current user
const createDeleteWorkflowHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const workflowId = request.params.workflowId;

      const _id = `wf:${workflowId}`;
      integration.debug('deleteWorkflow', _id);
      const workflow: Workflow = (await integration.db.get(_id)) as Workflow;
      if (!workflow) {
        return await reply.code(404).send({ error: 'Workflow not found' });
      }

      const ability = new PermissionChecker(request.session.get('permission' as 'cookie'));
      if (!ability.can(EObjectAction.DELETE, Workflow.fromJSON(workflow))) {
        return await reply.code(401).send({ error: 'Insufficient permission: DELETE' });
      }

      const result = await integration.deleteWorkflow(workflow);

      // TODO: Handle errors

      return await reply.status(200).send({ success: 'ok', result });
    }
  };
};

const getWorkflowsClientExport = function () {
  return {
    description: 'Get a list of workflows',
    params: []
  };
};

const createGetWorkflowsHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          bookmark: {
            type: 'string'
          },
          limit: {
            type: 'string'
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: {
              type: 'string'
            },
            workflows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string'
                  },
                  owner: {
                    type: 'string'
                  },
                  canDelete: {
                    type: 'boolean'
                  },
                  starred: {
                    type: 'boolean'
                  },
                  meta: getMetaSchema(),
                  ui: {
                    type: 'object',
                    template: {
                      type: 'string'
                    },
                    additionalProperties: true
                  }
                }
              }
            },
            skipped: {
              type: 'number'
            },
            remaining: {
              type: 'number'
            },
            currBookmark: {
              type: 'string'
            },
            nextBookmark: {
              type: 'string'
            },
            prevBookmark: {
              type: 'string'
            }
          }
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;
      //@ts-ignore
      const bookmark = request.query.bookmark;
      //@ts-ignore
      const pageSize = request.query.limit ? parseInt(request.query.limit) : 10;
      if (pageSize < 1 || pageSize > 500) {
        return await reply.status(400).send({ error: 'Invalid pageSize' });
      }

      const userIds = [user.id, '-----public-----'];
      const collection = await integration.getWorkflowSummariesAsCollection(userIds, true);

      const ability = new PermissionChecker(request.session.get('permission' as 'cookie'));

      const page = collection.getPage(pageSize, bookmark);

      const workflowsDisplayed = page.page.map((item: any) => {
        const workflow = item.value;
        let canDelete = true;

        if (integration.app.settings.get('omni:feature.permission')?.value) {
          canDelete = ability.can(EObjectAction.DELETE, Workflow.fromJSON(workflow));
        }

        let owner = 'Unknown';
        if (workflow.owner === '-----public-----') {
          owner = 'mercenaries.ai';
        } else if (workflow.owner === user.id) {
          owner = 'You';
        }

        const starred = Math.random() > 0.8; // TODO

        return {
          ...workflow,
          id: item.id,
          owner,
          canDelete,
          starred
        };
      });

      return await reply.status(200).send({
        success: 'ok',
        workflows: workflowsDisplayed,
        skipped: page.skipped,
        remaining: page.remaining,
        currBookmark: page.currBookmark,
        nextBookmark: page.nextBookmark,
        prevBookmark: page.prevBookmark
      });
    }
  };
};

// -------------------------------- clone workflow ------------------------------

const cloneWorkflowHandlerClientExport = function () {
  return {
    description: 'clone a workflow to a new user',
    params: []
  };
};

const cloneWorkflowHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      body: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          // version: { type: 'string' },
          meta: getMetaSchema()
        },
        required: ['id']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'string' },
            workflow: getRecipeSchema()
          },
          required: ['success', 'workflow']
        },
        403: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          },
          required: ['error'],
          additionalProperties: false
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;

      if (integration.app.settings.get('omni:feature.permission')?.value) {
        const ability = new PermissionChecker(request.session.get('permission' as 'cookie'));
        if (!ability?.can(EObjectAction.CREATE, EObjectName.WORKFLOW)) {
          throw new Error('Unauthorized access');
        }
      }

      const body: any = request.body;
      const result = await integration.cloneRecipe(body.id, user, body.meta);

      if (!result) {
        return await reply.status(403).send({ error: 'Workflow clone unsuccessful' });
      }

      return await reply.status(200).send({ success: 'ok', workflow: result });
    }
  };
};

// -------------------------------- update workflow ------------------------------

const updateWorkflowHandlerClientExport = function () {
  return {
    description: 'Update a workflow',
    params: [
      { name: 'id', required: true, type: 'string', description: 'The recipe id' },
      { name: 'rete', required: false, type: 'object', description: 'The new rete' },
      { name: 'meta', required: false, type: 'object', description: 'The new meta' }
    ]
  };
};

const createUpdateWorkflowHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'rete'],
        properties: {
          id: { type: 'string' },
          rete: { type: 'object', additionalProperties: true },
          meta: getMetaSchema(),
          ui: { type: 'object', additionalProperties: true }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'string' },
            workflow: getRecipeSchema(),
            flags: { type: 'array', items: { type: 'string' } }
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
      // @ts-ignore
      const body: { id: string; rete: any; meta?: any; ui?: any } = request.body || {};

      if (integration.app.settings.get('omni:feature.permission')?.value) {
        // @ts-ignore
        const ability = new PermissionChecker(request.session.get('permission'));
        if (!ability?.can(EObjectAction.UPDATE, EObjectName.WORKFLOW)) {
          throw new Error(`Insufficient permission: ${EObjectAction.UPDATE} ${EObjectName.WORKFLOW}`);
        }
      }

      const result = await integration.updateWorkflow(body.id, { rete: body.rete, meta: body.meta}, user);
      if (!result) {
        console.log('updateWorkflowHandler: updateWorkflow returned null');
        return await reply.status(403).send({ error: 'Workflow update unsuccessful' });
      }

      const flags = [];
      if (result.owner === user.id) flags.push('owner');
      if (result.owner === '-----public-----') {
        flags.push('public');
        flags.push('readonly');
      }

      return await reply.status(200).send({ success: 'ok', workflow: result, flags });
    }
  };
};

// -------------------------------- new workflow ------------------------------

const createWorkflowClientExport = function () {
  return {
    description: 'Create a new workflow',
    params: [
      { name: 'rete', required: true, type: 'object', description: 'The workflows rete' },
      { name: 'meta', required: false, type: 'object', description: 'The workflows meta data' }
    ]
  };
};

const createWorkflowClientHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      schema: {
        body: {
          type: 'object',
          properties: {
            rete: {
              type: 'object',
              additionalProperties: true
            },
            meta: getMetaSchema()
          },
          required: ['rete', 'meta']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'string' },
              workflow: getRecipeSchema()
            },
            required: ['success', 'workflow']
          }
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const user: User = request.user as User;
      // @ts-ignore
      const body: { rete: any; meta: IWorkflowMeta } = request.body || {};

      if (integration.app.settings.get('omni:feature.permission')?.value) {
        // @ts-ignore
        const ability = new PermissionChecker(request.session.get('permission'));
        if (!ability?.can(EObjectAction.CREATE, EObjectName.WORKFLOW)) {
          throw new Error('Unauthorized access');
        }
      }
      const result = await integration.createWorkflow(body, user);
      return await reply.status(200).send({ success: 'ok', workflow: result });
    }
  };
};

// --------------------------------- load workflow ---------------------------------

const loadWorkflowHandlerClientExport = function () {
  return {
    description: 'Load a workflow',
    params: []
  };
};

const loadWorkflowHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      params: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' }
          // version: { type: 'string' }
        },
        required: ['workflowId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'string' },
            workflow: getRecipeSchema(),
            flags: { type: 'array', items: { type: 'string' } }
          },
          required: ['success', 'workflow', 'flags']
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          },
          required: ['error']
        },
        500: {
          type: 'object',
          properties: {
            success: { type: 'string' },
            error: { type: 'string' }
          },
          required: ['success', 'error']
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      if (!integration.db) {
        return await reply.status(500).send({ success: 'error', error: 'Internal server error' });
      }

      const user: User = request.user as User;
      // @ts-ignore
      const workflowId = request.params.workflowId;

      // @ts-ignore
      const workflow = await integration.getRecipe(workflowId, user.id, true);

      if (!workflow) {
        return await reply.status(404).send({ error: 'Workflow not found' });
      }

      const flags = [];
      if (workflow.owner === user.id) flags.push('owner');
      if (workflow.owner === '-----public-----') {
        flags.push('public');
        flags.push('readonly');
      }

      return await reply.status(200).send({ success: 'ok', workflow, flags });
    }
  };
};

export {
  cloneWorkflowHandler,
  cloneWorkflowHandlerClientExport,
  createWorkflowClientExport,
  createWorkflowClientHandler,
  createGetWorkflowsHandler,
  getWorkflowsClientExport,
  deleteWorkflowClientExport,
  createDeleteWorkflowHandler,
  createUpdateWorkflowHandler,
  updateWorkflowHandlerClientExport,
  loadWorkflowHandler,
  loadWorkflowHandlerClientExport
};
