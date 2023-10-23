/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// upload.ts
//
//  Purpose:  Provides a simple file upload handler
//
// ---------------------------------------------------------------------------------------------
/*
import { type APIIntegration } from '../../APIIntegration'
import { type FastifyRequest, type FastifyReply } from 'fastify'

import path from 'path'
import fs from 'fs'
import { ensureDir } from 'fs-extra'
import util from 'util'
import { pipeline } from 'stream'
import sanitize from 'sanitize-filename'
const pump = util.promisify(pipeline)

const createFileUploadHandler = function (integration: APIIntegration, config: any) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      const parts = request.parts()
      let setname: string | null = null
      const hash = Math.floor(Math.random() * 90000) + 10000
      let intermediate: string | null = null
      let destination: string | null = null
      const images = []
      for await (const part of parts) {
        if ((part as any).file) {
          if (setname && destination) {
            const fileName = sanitize((part as any).filename)
            await pump((part as any).file, fs.createWriteStream(path.join(destination, fileName)))
            omnilog.log((part as any).filename)
            images.push(fileName)
          }
        } else {
          if (part.fieldname === 'set_name') {
            omnilog.log(part)

            setname = sanitize((part as any).fields.set_name.value)
            intermediate = setname + '_' + hash.toString(16)
            destination = path.join(process.cwd(), 'public', 'sets', intermediate)
            integration.debug('Uploading to', destination)
            await ensureDir(destination)
          }
          omnilog.log('Unknown field skipped', part)
        }
      }
      return await reply.send({ success: true, set_id: intermediate, images })
    } catch (ex) {
      integration.error(ex)
      return { success: false, error: 'Server side error processing image' }
    }
  }
}

export { createFileUploadHandler }
*/
