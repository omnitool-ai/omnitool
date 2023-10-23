/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// results.ts
//
//  Purpose:  Retrieve current workflow results from the database
// ---------------------------------------------------------------------------------------------

import { APIIntegration } from '../../APIIntegration';
import { type FastifyRequest, type FastifyReply } from 'fastify';
import { EObjectAction, type Workflow, type IWorkflowMeta } from 'omni-shared';
import { type WorkflowIntegration } from '../WorkflowIntegration';

let lastDeleteTime = 0;

const getWorkflowResults = async function (integration: WorkflowIntegration, workflowId: string): Promise<Workflow[]> {
  let ret: any = [];
  const deleteList: any[] = [];
  if (integration.db != null) {
    const result = await integration.db.list(`result:${workflowId}:`, undefined, true);

    // @ts-ignore

    // @ts-ignore
    ret = result.rows.map((r: any) => {
      return r.doc;
    });

    ret = ret.filter((r: any) => {
      if (r.expires > new Date().getTime()) {
        return true;
      }
      deleteList.push(r);
      return false;
    });
  }

  // If it's been 10 seconds since the last bulk delete, delete expired documents
  if (deleteList.length > 0 && lastDeleteTime + 1000 * 10 < Date.now()) {
    lastDeleteTime = Date.now();
    integration.db.deleteMany(deleteList);
  }

  return ret;
};

const getWorkflowResultsClientHandler = function () {
  return {
    description: 'Get a list of workflows',
    params: [
      { name: 'workflowId', required: true, type: 'string', description: 'The workflow to retrieve results for' }
    ]
  };
};

const createGetWorkflowResultsHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' }
        },
        required: ['workflowId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'string' },
            artifacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  created: { type: 'string' },
                  args: { type: 'array' }
                }
              }
            }
          },
          required: ['success', 'artifacts']
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const body: { workflowId: string } = request.body || request.query;

      // TODO: Add permission check
      // @ts-ignore
      // const ability = request.session.get("permission") as PureAbility
      // if (!ability.can(EObjectAction.READ, { id: body.workflowId })) {
      //   throw new Error("Unauthorized access")
      // }

      const result = await getWorkflowResults(integration, body.workflowId);

      const ret = {
        success: 'ok',
        artifacts: result.map((r: any) => {
          const run: any = { id: r.id, created: r.created, args: r.args };
          for (const k in r.artifacts) {
            run[k] = r.artifacts[k] || [];
          }
          return run;
        })
      };

      return await reply.status(200).send(ret);
    }
  };
};

export { getWorkflowResultsClientHandler, createGetWorkflowResultsHandler };
