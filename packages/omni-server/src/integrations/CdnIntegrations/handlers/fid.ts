/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//---------------------------------------------------------
// Endpoints for uploading and grabbing files from storage
//---------------------------------------------------------

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { type CdnIntegration, type ICDNFidServeOpts } from '../CdnIntegration';
import type MercsServer from '../../../core/Server';

const fidClientExport = function () {
  return {
    description: 'Retrieve a workflow artifact',
    params: [{ name: 'fid', required: true, type: 'string' }]
  };
};

const uploadClientExport = function () {
  return {
    method: 'POST',
    description: 'Retrieve a workflow artifact',
    params: [{ name: 'fid', required: true, type: 'string' }]
  };
};

// Simple Upload Hander
// TODO: Stream based version that can handle large files like video
const createUploadHandler = function (integration: CdnIntegration, config: any) {
  return {
    schema: {
      headers: {
        type: 'object',
        properties: {
          'Content-Type': {
            type: 'string',
            pattern: '.*multipart/form-data.*' // Ensures the request has this content-type. Right now this suffice, might need a custom validation function instead for more complex validation
          }
        },
        required: ['content-type']
      }
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.user) {
        throw new Error('User not logged in');
      }

      const parts = request.parts();
      integration.info('upload', parts);

      const files = [];
      let storageType = 'temporary'; // Default storage type

      for await (const part of parts) {
        if (!(part as any).file) {
          // This is a non-file field
          const value = await (part as any).value;
          if (part.fieldname === 'storageType' && ['permanent', 'temporary'].includes(value)) {
            storageType = value;
          }
        } else {
          // This is a file
          const buffer = await (part as any).toBuffer();
          const fileName = (part as any).filename;

          let res;
          if (storageType === 'permanent') {
            res = await integration.put(buffer, { fileName, userId: request.user.id, tags: ['upload'] });
          } else {
            res = await integration.putTemp(buffer, { fileName, userId: request.user.id, tags: ['upload'] });
          }

          files.push(res);
        }
      }

      return await reply.send(files);
    }
  };
};

const createFidHandler = function (integration: CdnIntegration, config: any) {
  return {
    schema: {
      params: {
        type: 'object',
        properties: {
          fid: { type: 'string' }
        },
        required: ['fid']
      },
      querystring: {
        type: 'object',
        properties: {
          obj: { type: 'boolean' },
          test: { type: 'boolean' }
        }
      }
      // TODO: Validate response
    },
    handler: async function (request: FastifyRequest, reply: FastifyReply) {
      // const start = performance.now()
      //@ts-expect-error
      const fid = request.params.fid as string;

      if (fid == null) {
        return await reply.status(422).send({ error: 'Missing fid' });
      }

      const cdn = (integration.app as MercsServer).cdn;
      //@ts-expect-error
      if (request.query.obj) {
        const fo = await cdn.find(fid);
        if (fo == null) {
          return await reply
            .status(404)
            .header('Cache-Control', 'no-cache, no-store, must-revalidate')
            .send({ error: 'File not found' });
        } else {
          return await reply.status(200).send(fo);
        }
      }

      if ((request.query as any).test === 'true') {
        if (await cdn.checkFileExists(fid)) {
          return await reply.status(200).send({ exists: true });
        } else {
          return await reply
            .status(410)
            .header('Cache-Control', 'no-cache, no-store, must-revalidate')
            .send({ exists: false });
        }
      }

      const defaults = { download: false };
      const opts = Object.assign({}, defaults, { ...(request.query as ICDNFidServeOpts) });

      omnilog.log(opts);
      try {
        const servedFile = await cdn.serveFile(fid, opts, reply);
        return servedFile;
      } catch (ex: any) {
        integration.error(ex);
        const status = ex.response?.status ?? 500;
        const replied = reply.status(status).send({ error: `${status} : An error occurred` });
        return await replied;
      }
    }
  };
};

export { createFidHandler, fidClientExport, createUploadHandler, uploadClientExport };
