/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// exec.ts
//
//  Purpose:  Executes a workflow sent from the client
//
// ---------------------------------------------------------------------------------------------

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { EObjectAction, EObjectName, type User, type Workflow } from 'omni-shared';
import { type WorkflowIntegration } from '../WorkflowIntegration';
import { type JobControllerService } from '../../../services/JobController/JobControllerService.js';
import assert from 'node:assert';

import { PermissionChecker } from '../../../helper/permission.js';

const execWorkflowClientExport = function () {
  return {
    description: 'Execute a workflow',
    params: [
      { name: 'workflow', required: true, type: 'object', description: 'The workflow to execute' },
      { name: 'args', required: false, type: 'object', description: 'optional args' },
      { name: 'startNode', required: false, type: 'number', description: 'optional start node' }
    ]
  };
};

const stopWorkflowClientExport = function () {
  return {
    description: 'Stop currently running workflows',
    params: []
  };
};

const startWorkflow = async (
  integration: WorkflowIntegration,
  workflowId: string,
  session: any,
  user: User,
  args?: any,
  startNode?: number,
  sender?: string,
  flags?: number
) => {
  assert(session.sessionId !== undefined);
  sender ??= 'omni';
  args ??= {};
  startNode ??= 0;

  const workflow = await integration.getRecipe(workflowId, user.id, true);
  if (!workflow) {
    throw new Error(`Recipe not found: ${workflowId}`);
  }
  integration.debug('startRecipe by id', workflowId);
  const jobService = integration.app.services.get('jobs') as JobControllerService;
  return await jobService.startRecipe(workflow, session.sessionId, user.id, args, startNode, sender);
};

const stopWorkflowHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      body: {
        type: 'object',
        properties: {
          jobId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {}
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      const jobService: JobControllerService = integration.app.services.get('jobs') as unknown as JobControllerService;
      const body: { jobId?: string } = request.body || {};
      const jobsStopped = jobService.stopJob(body.jobId);

      omnilog.log(`stopWorkflow stopped ${jobsStopped} jobs`);

      return await reply.status(200).send({});
    }
  };
};

const execWorkflowHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      body: {
        type: 'object',
        properties: {
          workflow: { type: 'string' },
          // version: { type: 'string' },
          args: { type: 'object' },
          startNode: { type: 'number' }
        },
        required: ['workflow']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            result: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                jobId: { type: 'string' },
                sender: { type: 'string' }
              },
              required: ['status', 'jobId', 'sender']
            }
          }
        },
        403: {
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
      // @ts-ignore

      const body: { workflow: any; version?: string; args?: any; startNode?: number } = request.body || {};
      const user = request.user as User;
      const sender = 'omni';
      integration.debug('Execute request', body);
      // @ts-ignore
      try {
        if (integration.app.settings.get('omni:feature.permission')?.value) {
          // @ts-ignore
          const ability = new PermissionChecker(request.session.get('permission'));
          if (!ability?.can(EObjectAction.EXECUTE, EObjectName.WORKFLOW)) {
            return await reply.status(403).send({ error: 'You do not have permission to execute the workflow' });
          }
        }

        const result: any = await startWorkflow(
          integration,
          body.workflow,
          request.session,
          user,
          body.args,
          body.startNode,
          sender
        );

        return await reply.status(200).send({ result: { status: 'JOB_STARTED', jobId: result.jobId, sender } });
      } catch (ex) {
        integration.error(ex);
        return await reply.status(500).send({ error: 'An error occurred' });
      }
    }
  };
};

export { execWorkflowHandler, execWorkflowClientExport, stopWorkflowHandler, stopWorkflowClientExport, startWorkflow };
