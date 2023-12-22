/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// results.ts
//
//  Purpose:  Retrieve current workflow results from the database
// ---------------------------------------------------------------------------------------------

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type WorkflowIntegration } from '../WorkflowIntegration';
import { type JobControllerService } from '../../../services/JobController/JobControllerService';


const getWorkflowResultsClientHandler = function () {
  return {
    description: 'Return job results',
    params: [
      { name: 'jobId', required: true, type: 'string', description: 'The job to retrieve results for' }
    ]
  };
};

const createGetWorkflowResultsHandler = function (integration: WorkflowIntegration, config: any) {
  return {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          jobId: { type: 'string' }
        },
        required: ['jobId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            text: { type: 'array', items: { type: 'string' } },
            job: {
              type: 'object',
              additionalProperties: true,
              properties:
              {
                
              }
            }
          },
          additionalProperties: true,
          required: ['job']
        }
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) : Promise<any> {
      // @ts-ignore
      const body: { jobId: string } = request.body || request.query;

      // TODO: Add permission check
      // @ts-ignore
      // const ability = request.session.get("permission") as PureAbility
      // if (!ability.can(EObjectAction.READ, { id: body.workflowId })) {
      //   throw new Error("Unauthorized access")
      // }

      const jobService = integration.app.services.get('jobs') as JobControllerService;
      const storage = jobService.kvStorage;
      try
      {
        if (!storage)
        {
          throw new Error('No storage available');
        }

        const result = storage.get('result.' + body.jobId)
        if (!result)
        {
          return await reply.status(404).send({ error: 'Job not found' });
        }
        if (result.job.userId !== request.user.id)
        {
          return await reply.status(403).send({ error: 'Unauthorized access' });
        }
        return await reply.status(200).send(result);
      }
      catch (ex)
      {
        return await reply.status(500).send({ error: (ex as any).message });
      }
      
     
    }
  };
};

export { getWorkflowResultsClientHandler, createGetWorkflowResultsHandler };
