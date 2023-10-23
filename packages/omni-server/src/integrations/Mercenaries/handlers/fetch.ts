/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// fetch.ts
//
//  Usage: server_fetch?url=<url>
// ---------------------------------------------------------------------------------------------

import axios from 'axios';
import { type APIIntegration } from '../../APIIntegration';
import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type HttpClientService } from 'services/HttpClientService';

const createFetchExport = function () {
  return {
    description: 'Fetch a url via the server',
    params: [
      {
        name: 'url',
        type: 'string',
        description: 'The url to fetch',
        required: true
      }
    ]
  };
};

const serverFetch = async function (
  integration: APIIntegration,
  url: string
): Promise<{ data: any; headers: { 'Content-Length': any; 'Content-Type': any } }> {
  const httpClient = integration.app.services.get('http_client') as HttpClientService;

  const response = await httpClient.request({
    url,
    timeout: 30 * 1000, // 30 seconds time-out
    responseType: 'arraybuffer'
  });

  const headers = {
    'Content-Length': response.data.length,
    'Content-Type': response.headers['content-type']
  };

  return { data: response.data, headers };
};

const createFetchHandler = function (integration: APIIntegration, config: any) {
  return {
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        // Get the image path from the query string parameter
        // @ts-ignore
        const imagePath = request.query.url ?? request.body?.url;

        if (imagePath == null) {
          integration.warn('Missing url parameter', request.query, request.body);
          return await reply.status(422).send({ error: 'Missing url parameter' });
        }

        integration.debug('/server_fetch request:\n', imagePath, '\n');
        // Make a request to the image path

        const response = await serverFetch(integration, imagePath);
        reply.header('Content-Length', response.headers['Content-Length']);
        reply.header('Content-Type', response.headers['Content-Type']);
        // Pipe the image data from the Axios response to the Fastify response

        return await reply.status(200).send(response.data);
      } catch (error) {
        integration.error('Error', error);
        // Handle the error
        return await reply.status(500).send(error);
      }
    }
  };
};

export { createFetchHandler, createFetchExport, serverFetch };
