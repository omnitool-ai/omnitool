/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------
// Local CDN Integration
//
//  A mock integeration that stores files in a local directory
//  rather than using a CDN
//
// ---------------------------------------------------------------

import { type IntegrationsManager } from 'omni-shared';
import {
  CdnIntegration,
  CdnResource,
  type ICdnTicket,
  type ICdnIntegrationConfig,
  type ICdnResource,
  type ICDNFidServeOpts,
  EOmniFileTypes
} from './CdnIntegration.js';
import mime from 'mime-types';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { ensureDir } from 'fs-extra';
import detectContentType from 'detect-content-type';
import { fileTypeFromBuffer } from 'file-type';
import { performance } from 'perf_hooks';
import sharp from 'sharp';
import { Readable, PassThrough } from 'stream';
import murmurHash from 'imurmurhash';

import { customAlphabet } from 'nanoid';
import path from 'path';
import { file as tmpFile } from 'tmp-promise';
import type MercsServer from 'core/Server.js';

const HARD_DELETE_AFTER_MINUTES = 60 * 24 * 7; // 7 days
const THUMBNAIL_RETENTION = '7d';

const MIN_SIZE = 32; // Set your min size
const MAX_SIZE = 512; // Set your max size

// These are the allowed fit options in sharp
const ALLOWED_FIT_OPTIONS = ['cover', 'contain', 'fill', 'inside', 'outside'];
// These are the allowed position options in sharp
const ALLOWED_POSITION_OPTIONS = [
  'center',
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
  'entropy',
  'attention'
];

// FID Logic for LocalCDN
const fidRegex = /[^a-z0-9,]/g;
const NANOID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const fidGenerator = customAlphabet(NANOID_ALPHABET, 10);

class CdnObjectNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CDN_NOT_FOUND';
  }
}

interface ILocalCdnIntegrationConfigDetails extends ICdnIntegrationConfig {
  root: string; // the directory root where we store things
  url: string; // the url to the root directory
  default_ttl: string;
}

interface ILocalCdnIntegrationConfig extends ICdnIntegrationConfig {
  local: ILocalCdnIntegrationConfigDetails;
}

class LocalCdnIntegration extends CdnIntegration {
  missCache: Set<string>;

  constructor(id: string, manager: IntegrationsManager, config: ILocalCdnIntegrationConfig) {
    super(id, manager, config || {});

    this.missCache = new Set<string>();

    if (this.detailConfig.root == null || this.detailConfig.url == null) {
      throw new Error('Local CDN Integration requires a root and url set in the configuration!');
    }
  }

  get detailConfig(): ILocalCdnIntegrationConfigDetails {
    return (this.config as ILocalCdnIntegrationConfig).local;
  }

  async load(): Promise<boolean> {
    this.info('CDN is LOCAL', this.detailConfig);
    return await super.load();
  }

  async writeObject(key: string, data: Buffer) {
    const file = this.getPathForFid(key);
    this.debug('writeObject()', key, file);
    await fs.writeFile(file, data);
    return await fs.stat(file);
  }

  async hasFile(key: string) {
    const file = this.getPathForFid(key);
    this.info('hasFile', key, file);
    try {
      const stats = await fs.stat(file);
      if (stats.isFile()) {
        this.info('hasFile true');
        return true;
      }
    } catch {
      this.verbose('hasFile()', 'file not found', key, file);
    }
    this.info('hasFile false');
    this.verbose('hasFile()', 'isFile false', key, file);
    return false;
  }

  async readObject(key: string) {
    const file = this.getPathForFid(key);
    this.debug('readObject()', key, file);

    // check if the file exists with stat, if not, call kvStorage.del(key)
    if (await this.hasFile(key)) {
      return await fs.readFile(file);
    }
    //await this.softDelete(key)
    this.kvStorage.del(`file.${key}`);
    throw new CdnObjectNotFoundError(`cdn.readObject(): no record found for ${key}`);
  }

  async deleteObject(key: string) {
    const file = this.getPathForFid(key);
    const stat = await fs.stat(file);
    if (stat && stat.isFile()) {
      this.verbose(`Purging expired file ${key} from local CDN`);
      this.debug('deleteObject()', key, file);
      try {
        await fs.unlink(file);
        return true;
      } catch (ex) {
        this.warn(`Error Purging expired file ${key} from local CDN`, ex);
        return false;
      }
    }
    return false;
  }

  getPathForFid(fid: string) {
    fid = fid.replace(fidRegex, ''); // sanitize
    const [volume, file] = fid.split(','); // split into volume and file
    const fileName = `${this.detailConfig.root}/${volume}/${file}`;
    this.verbose('getPathForFid', fid, fileName);
    return fileName;
  }

  // This fires whenever the kvstore expires a ew
  override async onExpired(purgedKeys: string[] = []): Promise<any> {
    this.info(`Purging ${purgedKeys.length} expired files from local CDN`);
    for (const key of purgedKeys) {
      if (key.startsWith('file.')) {
        const fid = key.substring(5);
        try {
          await this.deleteObject(fid);
        } catch (ex) {
          this.verbose(`Error Purging expired file ${fid} from local CDN`, ex);
        }
      }
    }
  }

  // returns a ticket for a file
  async assign(opts: { ttl?: string }): Promise<ICdnTicket | null> {
    opts ??= {};
    const volumeId = Math.floor(Math.random() * 99)
      .toString()
      .padStart(2, '0');
    /*const fileId = Math.floor(Math.random() * (0xffffffffff + 1))
      .toString(16)
      .padStart(10, '0');
    */
    const fileId = fidGenerator(10).padStart(10, '0');

    await ensureDir(`${this.detailConfig.root}/${volumeId}`);

    const ret = {
      fid: `${volumeId},${fileId}`,
      count: 1,
      url: this.detailConfig.url,
      publicUrl: this.detailConfig.url
    };

    return ret;
  }

  // sets the expiry for a file
  async setExpiry(file: CdnResource, userId: string, expiry: undefined | number) {
    if (file && file.fid) {
      if (expiry != null) {
        this.kvStorage.setExpiry(`file.${file.fid}`, expiry);
        file.expires = expiry;
      } else {
        this.kvStorage.setExpiry(`file.${file.fid}`, null);
        file.expires = Number.MAX_SAFE_INTEGER;
      }
      return this.updateFileEntry(file);
    }
  }
  async softDelete(fid: string): Promise<any> {
    // TODO: For proper multi user support, we need to gate delete operations by userId:
    // You shouldn't be able to delete an object you don't own, even if you know it's ID

    if (!fid || typeof fid !== 'string' || fid.length < 10) {
      this.warn('Softdelete Invalid fid', fid);
      return false;
    }

    // remove everything that's not hex or comma to avoid any kind of injection
    fid = fid.replace(fidRegex, '');

    const obj = this.kvStorage.get(`file.${fid}`);
    if (obj != null) {
      this.info('Soft deleting', fid);
      // create a tracking entry
      const hard_delete_after_ms = HARD_DELETE_AFTER_MINUTES * 1000 * 60;
      this.kvStorage.softDelete(`file.${fid}`, obj.expiry ?? Date.now() + hard_delete_after_ms);

      return true;
    } else {
      return false;
    }
  }

  guessIfBase64(str: string): boolean {
    if (!str || str.length & 3) {
      return false;
    }

    const mainBodyPattern = /^[A-Za-z0-9+/]+$/; // Only characters from the base64 alphabet
    const suffixPattern = /^(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?$/; // ... or with Padding

    const mainBody = str.substring(0, str.length - 4);
    const suffix = str.substring(str.length - 4);
    return mainBodyPattern.test(mainBody) && suffixPattern.test(suffix);
  }

  // Writes a file to storage using the assigned ticket
  // It will try to infer the mime type and extension and alter the ticket fid to amend inferred extension if needed
  async write(
    record: { data: Buffer | string },
    ticket: { fid: string; url: string; publicUrl: string },
    opts: {
      ttl?: string;
      mimeType?: string;
      fileName?: string;
      userId?: string;
      jobId?: string;
      tags?: string[];
      fileType?: EOmniFileTypes;
    },
    meta?: any
  ): Promise<CdnResource> {
    this.info('cdn.write()', 'writing file', ticket, opts);

    // dereference metadata
    meta = JSON.parse(JSON.stringify(meta || {})) ?? {};

    // @ts-ignore
    if (record.data.url && !record.data.ticket) {
      // @ts-ignore
      record.data = record.data.url;
    }

    let encoding = 'binary';

    // When we receive strings, it's a bit tricky to figure out what to do
    if (typeof record.data === 'string') {
      // let's start assuming base64
      encoding = 'base64';
      // strip header if needed
      if (opts.mimeType?.startsWith('text/')) {
        opts.fileType ??= EOmniFileTypes.document;
        // unless it's text, then we assume utf8
        encoding = 'utf8';
      } else if (record.data.indexOf('data:') === 0) {
        // seems like a data url, let's strip the header
        record.data = record.data.split(',')[1];
      } else if (
        // seems like a  url, use our interfal fetch to get it
        // Note: this does act as a CORS proxy
        record.data.indexOf('http') === 0 ||
        record.data.indexOf('/fid/') === 0
      ) {
        const resp = await CdnIntegration.fetch(record.data);
        record.data = resp.data;
        // it's a cdn object, get it
      } else if (record.data.indexOf('fid://') === 0) {
        const fid = record.data.split('://')[1];
        this.success('cdn:write()', 'found fid, returning', fid);
        return await this.getByFid(fid);
      }
      // let's try some heuristics
      else if (this.guessIfBase64(record.data)) {
        this.warn('Someone passed a base64 encoded image without header into cdn.write(), so we guessed...');
        // record.data = record.data
      }
      // everything else is probably a text file?
      else {
        encoding = 'utf8';
        opts.mimeType ??= 'text/plain';
        opts.fileType ??= EOmniFileTypes.document;
      }

      // @ts-ignore
      record.data = Buffer.from(record.data, encoding);
    }

    if (!record.data) {
      throw new Error('cdn.write(): no data supplied');
    }

    // ---------------------- Sanitize the metadata filename ---------------------------------
    let extName;
    let mimeType = opts.mimeType;
    let fileName = opts.fileName;

    // If we're dealing with text, let's augment the meta-data a bit
    if (encoding === 'utf8' && mimeType?.startsWith('text/')) {
      if (mimeType.startsWith('text/markdown')) {
        // Try to infer reasonable filenames
        fileName =
          fileName ??
          record.data
            .toString()
            .substring(0, 20)
            .trim()
            .replace(/[^a-z0-9]/gi, '_');
        extName = 'md';
      } else if (mimeType.startsWith('text/html')) {
        extName = 'html';
      } else if (mimeType.startsWith('text/svg')) {
        extName = 'html';
      } else {
        // Try to infer reasonable filenames
        fileName =
          fileName ??
          record.data
            .toString()
            .substring(0, 20)
            .trim()
            .replace(/[^a-z0-9]/gi, '_');
        extName = 'txt';
      }
    } else {
      // For non text types, we try various ways of identifying the mime type
      if (!mimeType || !mimeType.startsWith('text/')) {
        const t = await fileTypeFromBuffer(record.data);
        if (t != null) {
          mimeType = t.mime ?? mimeType;
          extName = t.ext;
        } else {
          mimeType = detectContentType(record.data);
        }
      }
    }

    const sanitizedFilename = this.mangleFilename(
      fileName ?? ticket.fid,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      extName || mime.extension(mimeType) || undefined
    );

    // ---------------------- Generate the on disk cdn object filename  ----------------------

    const fileType = opts.fileType ?? CdnResource.determineFileTypeFromMimeType(mimeType) ?? EOmniFileTypes.file;
    let nsfw:
      | {
          isNsfw?: boolean;
          Sexy?: number;
          Porn?: number;
          Hentai?: number;
          Drawing?: number;
          Neutral?: number;
        }
      | undefined;

    if (fileType === EOmniFileTypes.image) {
      try {
        //@ts-ignore
        if (this.app.options.uncensored) {
          meta.nsfw = {
            status: 'disabled',
            reason: '--uncensored option activated'
          };
        } else {
          //@ts-ignore
          const result = await this.app.nsfwCheck(record.data, { maxDimensions: 299 });
          nsfw = { ...result.classes, isNsfw: result.isNsfw, status: 'success' };
          meta.nsfw = nsfw;
        }
      } catch (err: unknown) {
        this.error('nsfwCheck failed', err);
        meta.nsfw = {
          status: 'failed',
          reason: (err as any)?.message
        };
      }
    }

    const result = await this.writeObject(ticket.fid, record.data);
    let ttl: number | undefined = this.parseTTL(opts.ttl ?? '');

    const expiresAt = ttl > 0 ? ttl + Date.now() : Number.MAX_SAFE_INTEGER; // permanent

    const file = new CdnResource({
      fid: ticket.fid,
      ticket,
      fileType,
      expires: expiresAt, // permanent
      fileName: sanitizedFilename,
      size: result.size,
      url: this.getCdnUrl(ticket),
      furl: '',
      mimeType,
      meta
    });
    if (file.isImage()) {
      file.meta = Object.assign(file.meta, CdnResource.getImageMeta(record.data));
    }

    if (ttl > 0) {
      /* empty */
    } else {
      ttl = undefined;
    }

    let tags: string[] | undefined;
    if (opts.tags && Array.isArray(opts.tags) && opts.tags.length > 0) {
      tags = opts.tags.map((t: string) => `tag.${t}`);
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    if (opts.userId || opts.jobId) {
      tags ??= [];
      //if (opts.userId) tags = tags.concat([`user.${opts.userId}`])
      if (opts.jobId) tags = tags.concat([`job.${opts.jobId}`]);
    }

    this.kvStorage.set(
      `file.${ticket.fid}`,
      file,
      ttl ? ttl + Date.now() : undefined,
      tags,
      opts.userId?.trim().toLowerCase()
    );

    // Remove the fid from the missCache since it now exists
    this.missCache.delete(ticket.fid);

    this.verbose('cdn.write()', result); // {"size": 1234}

    if (opts.userId) {
      const server = this.app as MercsServer;
      await server.sendToastToUser(opts.userId, {
        message: `File created: ${file.fileName}`,
        options: { type: 'info' }
      });
    }

    return file;
  }

  async updateFileEntry(file: ICdnResource): Promise<ICdnResource> {
    if (file) {
      this.kvStorage.updateValue(`file.${file.fid}`, file);
    }
    return await Promise.resolve(file);
  }

  async importLocalFile(filePath: string, tags: string[] = [], userId?: string): Promise<ICdnResource | null> {
    const buffer = await fs.readFile(filePath);
    const inputString = buffer.toString('binary'); // Convert buffer to binary string
    const hash = murmurHash(inputString + filePath)
      .result()
      .toString();

    const existsFid = this.kvStorage.get(`sample-import.${hash}`);
    if (existsFid) {
      this.info('Sample with hash', hash, 'already exists');
      //return await this.find(existsFid)
      return null;
    } else {
      this.info('Importing sample with hash ', hash, '...');
      const result = await this.put(buffer, { fileName: path.basename(filePath), tags, userId });
      this.kvStorage.set(`sample-import.${hash}`, result.fid);
      return result;
    }
  }

  async put(
    data: Buffer | string,
    opts?: {
      ttl?: string;
      mimeType?: string;
      fileName?: string;
      userId?: string;
      jobId?: string;
      tags?: string[];
      fileType?: EOmniFileTypes;
    },
    meta?: any
  ): Promise<CdnResource> {
    opts ??= {};
    const ticket: ICdnTicket | null = await this.assign(opts);
    if (ticket != null) {
      const result = await this.write({ data }, ticket, opts, meta);
      this.success('put()', result, result.ticket);
      // @ts-nocheck

      return result;
    }

    throw new Error('cdn.put(): no Ticket supplied');
  }

  // Store a file for a temporary period of time
  async putTemp(
    data: Buffer | string,
    opts?: {
      ttl?: string;
      mimeType?: string;
      fileName?: string;
      userId?: string;
      jobId?: string;
      tags?: string[];
      fileType?: EOmniFileTypes;
    },
    meta?: any
  ): Promise<CdnResource> {
    opts ??= {};
    opts.ttl ??= this.detailConfig.default_ttl;
    this.info('cdn.putTemp()', opts, meta, this.detailConfig);
    return await this.put(data, opts, meta);
  }

  // returns the volume server for a specific fid
  async find(fid: string, userId?: string): Promise<CdnResource | null> {
    // Currently the CDN will happily serve any file to anyone as long as they know a valid fid
    // In the future we may want to gate access by user session, which could be done here by
    // validating the userId against the tags of the raw entry
    // TODO: Slice userId to perform access check
    if (fid == null || fid.length == 0)
    {
      throw new Error("Null file identifier passed to cdn.find")
    }
    // Allow 
    if (fid.startsWith('sample-import:'))
    {
      const actualFid = this.kvStorage.get(fid.replace('sample-import:', 'sample-import.'))
      console.warn("looking for static file",fid, actualFid)
      if (actualFid != null)
      {
        fid = actualFid
      }
    }

    const ret = await Promise.resolve(this.kvStorage.get(`file.${fid}`));
    if (ret) {
      ret.fid ??= fid;
    }
    const resource = new CdnResource(ret)
    return resource;
  }

  async getByFid(fid: string, opts?: any, format?: 'asBase64' | 'stream' | 'file'): Promise<CdnResource> {
    return await this.get({ fid }, opts, format);
  }

  async get(
    ticket: Partial<ICdnTicket>,
    opts?: object,
    format?: 'asBase64' | 'base64' | 'stream' | 'file'
  ): Promise<CdnResource> {
    // @ts-expect-error
    if (ticket instanceof CdnResource || ticket.ticket) {
      // @ts-expect-error
      ticket = ticket.ticket;
    }
    let fid = ticket.fid;
    if (!fid) {
      const error = new CdnObjectNotFoundError(`cdn.get(): no record found for ${ticket.fid}`);
      throw error;
    }

    // First retrieve metadata from kv storage
    const cdnRecord = await this.find(fid);
    if (cdnRecord === null) {
      const error = new CdnObjectNotFoundError(`cdn.get(): no record found for ${ticket.fid}`);
      throw error;
    }

    // Fid may have been translated, so we have to update here
    fid = cdnRecord.fid

    // If we're asked for a stream, get it
    if (format === 'stream') {
      const fileLocation = this.getPathForFid(fid);
      if (await this.hasFile(fid)) {
        cdnRecord.data = createReadStream(fileLocation).on('error', (err) => {
          this.error('get() failed with error', err);
        });
        return cdnRecord;
      } else {
        this.kvStorage.del(`file.${ticket.fid}`);
        const error = new CdnObjectNotFoundError(`cdn.get(): no record found for ${ticket.fid}`);
        throw error;
      }
    } else if (format === 'file') {
      cdnRecord.data = await tmpFile(); // const { path, fd, cleanup } =
      await fs.copyFile(this.getPathForFid(fid), cdnRecord.data.path);

      return cdnRecord;
    }

    const data = await this.readObject(fid);
    if (format === 'base64' || format === 'asBase64') {
      cdnRecord.data = data.toString('base64');
    } else {
      cdnRecord.data = data;
    }

    // Patch for legacy files
    if (!cdnRecord.fid) {
      cdnRecord.fid = fid;
    }

    return cdnRecord;
  }

  async checkFileExists(fid: string): Promise<boolean> {
    const record = await this.find(fid) 
    return record != null;
  }

  async serveFile(fid: string, opts: ICDNFidServeOpts, reply: any): Promise<any> {
    const start = performance.now();
    opts ??= {};
    const result = this.serveFileInternal(fid, opts, reply);
    const statusCode = reply?.statusCode ?? 'unknownStatusCode';
    this.debug(`CDN: ${fid} ${statusCode} took ${Math.max(1, performance.now() - start).toFixed()} ms`);

    return await result;
  }

  async serveFileResponse(download: boolean, file: any, dataStream: PassThrough | Readable, reply: any) {
    if (download) {
      return reply
        .header('Content-Description', 'File Transfer')
        .header('Content-Length', file.size)
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
        .header('Content-Transfer-Encoding', 'binary')
        .send(dataStream);
    } else {
      return reply
        .header('Content-Length', file.size)
        .header('Content-type', file.mimeType)
        .header('Content-Disposition', `inline; filename="${file.fileName}"`)
        .header('Content-Transfer-Encoding', 'binary')
        .header(
          'Cache-Control',
          `public, max-age=${file.expires ? Math.max(0, file.expires - Date.now() / 1000) : 24 * 60 * 60}, immutable`
        )
        .send(dataStream);
    }
  }

  async serveFileInternal(fid: string, opts: ICDNFidServeOpts, reply: any): Promise<any> {
    // Strip potential extension
    const lastDotIndex = fid.lastIndexOf('.');
    if (lastDotIndex !== -1) {
      fid = fid.substring(0, lastDotIndex);
    }

    if (this.missCache.has(fid)) {
      return this.fileNotFoundReply(reply, 'missCache');
    }

    const hash = murmurHash(JSON.stringify(opts)).result().toString();
    const thumbnailKey = `thumb.${fid}.${hash}`;

    // Attempt to get the cached thumbnail
    const cachedThumbnail = this.kvStorage.get(thumbnailKey);
    if (cachedThumbnail) {
      this.verbose('CDN: thumbnail from cache', thumbnailKey);
      // If the thumbnail exists in cache, serve it directly
      return reply.send(cachedThumbnail);
    }

    try {
      const file = await this.get({ fid }, {}, 'stream');

      if (file == null || file.data == null) {
        this.missCache.add(fid);
        return this.fileNotFoundReply(reply, `${file == null ? 'file is null' : 'no data'}`);
      }

      const dataStream: Readable = file.data as Readable;

      const pass = new PassThrough();

      // validate and sanitize opts

      const download = (opts.download as any) === 'true' || opts.download === true;

      if (!file.isImage()) {
        return await this.serveFileResponse(download, file, dataStream, reply);
      }

      let width = parseInt(opts.width?.toString() ?? '');
      let height = parseInt(opts.height?.toString() ?? '');
      const fit = opts.fit;
      const position = opts.position;

      // If only width or height is provided, assume square
      if (isNaN(width) && !isNaN(height)) {
        width = height;
      } else if (!isNaN(width) && isNaN(height)) {
        height = width;
      }

      // Validate width, height, fit, and position options
      if (width > 0 && height > 0) {
        if (
          width % 32 === 0 &&
          height % 32 === 0 &&
          width >= MIN_SIZE &&
          width <= MAX_SIZE &&
          height >= MIN_SIZE &&
          height <= MAX_SIZE &&
          (fit === undefined || ALLOWED_FIT_OPTIONS.includes(fit)) &&
          (position === undefined || ALLOWED_POSITION_OPTIONS.includes(position))
        ) {
          let transform = sharp().resize({
            width,
            height,
            fit,
            position,
            fastShrinkOnLoad: true
          });

          // if the file is flagged nsfw, blur it
          //@ts-ignore
          if (file.meta.nsfw?.isNsfw && !this.app.options.uncensored) {
            transform = transform.blur(20);
          }

          dataStream.pipe(transform).pipe(pass);

          const chunks: Buffer[] = [];

          return await new Promise((resolve, reject) => {
            pass
              .on('data', (chunk) => chunks.push(chunk))
              .on('end', () => {
                this.info('CDN: thumbnail generated', thumbnailKey);
                const thumbnailBuffer = Buffer.concat(chunks);
                const ttl = Math.max(
                  1,
                  Math.min(
                    this.parseTTL(THUMBNAIL_RETENTION),
                    file.expires ? file.expires - Date.now() : this.parseTTL(THUMBNAIL_RETENTION)
                  )
                );

                this.kvStorage.set(thumbnailKey, thumbnailBuffer, ttl > 0 ? ttl + Date.now() : undefined);
                file.size = thumbnailBuffer.length;
                resolve(this.serveFileResponse(download, file, Readable.from(thumbnailBuffer), reply));
              });
          });
        } else {
          return reply.status(422).send({ error: 'Invalid resize options provided.' + JSON.stringify(opts) });
        }
      }
      return await this.serveFileResponse(download, file, dataStream, reply);
    } catch (ex: any) {
      this.missCache.add(fid);
      omnilog.error(ex);
      if (ex instanceof CdnObjectNotFoundError) {
        return this.fileNotFoundReply(reply, ex.message);
      }
      return reply.status(500).send({ error: 'Internal server error' }); // Catch all internal server error.
    }
  }

  fileNotFoundReply(reply: any, reason: string) {
    return reply
      .status(410)
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send({ exists: false, reason });
  }
}

export { LocalCdnIntegration, type ILocalCdnIntegrationConfig };
