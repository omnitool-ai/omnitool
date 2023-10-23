/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// ping.ts
//
//  Purpose:  Provides a default API integration for Mercenaries functions
//
//  Usage: 1. In integration's load function, add it to the handlers collection
//            this.handlers.set('ping', createPingHandler)
//         2. In mercs.yaml, declare the route mapping to it
// ---------------------------------------------------------------------------------------------

import { type JobControllerService } from 'services/JobController/JobControllerService';
import { type APIIntegration } from '../../APIIntegration';
import { type FastifyRequest, type FastifyReply } from 'fastify';

const jobsClientExport = function () {
  return {
    description: 'Get information about jobs from the server',
    params: []
  };
};

// This is the server function. When running a workflow on the server, we just call this.
const getJobs = function (integration: APIIntegration, payload: any) {
  const jobService: JobControllerService = integration.app.services.get('jobs') as unknown as JobControllerService;
  const jobs = (Array.from(jobService.jobs.values()) ?? []).map((c) => c.toJSON(payload));
  return { jobs };
};

const createJobsHandler = function (integration: APIIntegration, config: any) {
  return {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            jobs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  state: { type: 'string' },
                  user: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      // @ts-ignore
      const body = Object.assign({}, request.body, request.query);

      integration.debug('Jobs request', body);
      const result = getJobs(integration, body);
      return reply.send(result);
    }
  };
};

export { createJobsHandler, jobsClientExport };
