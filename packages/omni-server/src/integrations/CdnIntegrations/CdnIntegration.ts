/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------------------------
// Integration with SeaweedFS, a fast distributed storage system for blobs, objects,
//  files, and data lake, for billions of files. Blob store has O(1) disk seek, cloud tiering.
//
//    https://github.com/seaweedfs/seaweedfs
//
// --------------------------------------------------------------------------------------------

// TODO: [georg] - A better design would be an abstract CDN interface with a SeaweedFS, fileIO, garage, etc implementation

import { APIIntegration, type IAPIIntegrationConfig } from '../APIIntegration.js';
import { createFidHandler, createUploadHandler, fidClientExport, uploadClientExport } from './handlers/fid.js';
import imageSize from 'image-size';
import axios from 'axios';
import sanitize from 'sanitize-filename';
import { basename, extname, join as joinPath } from 'path';
import { type IKVStorageConfig, KVStorage } from '../../core/KVStorage.js';

import type MercsServer from '../../core/Server.js';
import { scanDirectory } from '../../helper/utils.js';

import { type ICdnResource, EOmniFileTypes, OmniBaseResource } from 'omni-sdk';

interface ICDNFidServeOpts {
  download?: boolean;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  position?: string;
  background?: [number, number, number];
  withoutEnlargement?: boolean;
  kernel?: string;
}

interface ICdnIntegrationConfig extends IAPIIntegrationConfig {
  localRoute?: string;
  useLocalRoute?: boolean;
  kvStorage?: IKVStorageConfig;
}

interface ICdnTicket {
  fid: string;
  url: string;
  publicUrl: string;
  count?: number;
}

class CdnResource extends OmniBaseResource {
  constructor(resource: ICdnResource) {
    super(resource);
  }

  static getImageMeta(cdnResource: OmniBaseResource | Buffer): any {
    if (cdnResource == null) {
      return;
    }

    try {
      // @ts-ignore
      const buffer: Buffer =
        cdnResource instanceof Buffer ? cdnResource : cdnResource.data instanceof Buffer ? cdnResource.data : undefined;

      if (buffer != null) {
        return imageSize(buffer);
      }
    } catch (ex) {
      omnilog.error(ex);
      return {};
    }
  }

  asBase64(addHeader?: boolean): string | undefined {
    if (this.data instanceof Buffer) {
      if (addHeader) {
        return `data:${this.mimeType};base64,${this.data.toString('base64')}`;
      } else {
        return this.data.toString('base64');
      }
    } else if (typeof this.data === 'string') {
      return this.data;
    }
  }

  asBuffer(): Buffer | undefined {
    if (this.data instanceof Buffer) {
      return this.data;
    } else {
      omnilog.error('Invalid data type detected:', typeof this.data);
    }
  }
}

abstract class CdnIntegration extends APIIntegration {
  public _kvStorage?: KVStorage;

  abstract assign(opts: { ttl?: string }): Promise<ICdnTicket | null>;
  // abstract delete(file: ): Promise<any>
  abstract write(
    record: { data: Buffer | string },
    ticket: { fid: string; url: string; publicUrl: string },
    opts: { ttl?: string; mimeType?: string; fileName?: string },
    meta?: any
  ): Promise<CdnResource>;
  abstract put(
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
  ): Promise<CdnResource>;
  abstract putTemp(
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
  ): Promise<CdnResource>;
  abstract find(fid: string): Promise<ICdnResource | null>;
  abstract get(ticket: ICdnTicket, opts?: any, format?: 'asBase64' | 'stream' | 'file'): Promise<CdnResource>;
  abstract serveFile(fid: string, opts: { download?: boolean }, reply: any): Promise<any>;
  abstract checkFileExists(fid: string): Promise<boolean>;
  abstract importLocalFile(filePath: string, tags: string[], userId?: string): Promise<ICdnResource | null>;

  async load(): Promise<boolean> {
    this.handlers.set('fid', createFidHandler);
    this.clientExports.set('fid', fidClientExport);
    this.handlers.set('fidupload', createUploadHandler);
    this.clientExports.set('fidupload', uploadClientExport);

    const config = (this.config as ICdnIntegrationConfig).kvStorage;
    if (config != null) {
      this._kvStorage = new KVStorage(this, config);
      if (!(await this._kvStorage.init())) {
        throw new Error('KVStorage failed to start');
      }

      this._kvStorage?.events.on('expired', this.onExpired.bind(this));

      await this._kvStorage?.vacuum([]);
      const chown = (this.app as MercsServer).options.chown;
      if (chown != null) {
        this.warn('Transferring ownership of all unknown files to ' + chown);
        const tag = chown.trim();
        this.success(this._kvStorage?.db.prepare('UPDATE kvstore SET owner = ? WHERE owner IS NULL').run(tag));
      }
    }
    this.info('Looking for samples to import...');
    const directoryPath = joinPath(process.cwd(), 'config.default', 'samples');
    const files = await scanDirectory(directoryPath);
    this.debug('CdnIntegration:load:files');

    const cdnFiles = await Promise.all(
      files.map(async (file) => {
        return this.importLocalFile(file, ['sample']);
      })
    );
    this.success('Imported ' + cdnFiles.filter((f) => f).length + ' new sample files');

    return await super.load();
  }

  async onExpired(purgedKeys: string[]): Promise<any> {}

  async stop(): Promise<boolean> {
    this._kvStorage?.events.off('vacuum', this.onExpired.bind(this));

    await this._kvStorage?.stop();
    return true;
  }

  get kvStorage(): KVStorage {
    if (this._kvStorage == null) {
      throw new Error('KV Storage accessed before loaded');
    }
    return this._kvStorage;
  }

  // Parse Seaweed style ttl string to ms
  parseTTL(ttl: string): number {
    if (!ttl || ttl.length === 0) return 0;
    const ttlNumber = parseInt(ttl.slice(0, -1), 10);
    const ttlUnit = ttl.slice(-1);

    switch (ttlUnit) {
      case 's': // seconds
        return ttlNumber * 1000;
      case 'm': // minutes
        return ttlNumber * 1000 * 60;
      case 'h': // hours
        return ttlNumber * 1000 * 60 * 60;
      case 'd': // days
        return ttlNumber * 1000 * 60 * 60 * 24;
      default:
        throw new Error(`Unrecognized TTL unit: ${ttlUnit}`);
    }
  }

  //mangle a filename to make it safe for the cdn
  mangleFilename(fileName: string, overrideExtension?: string): string {
    const newName = sanitize(fileName, { replacement: '_' }).toLowerCase();
    let ext = extname(newName);
    const base = basename(newName, ext);
    if (overrideExtension && !overrideExtension.startsWith('.')) {
      overrideExtension = '.' + overrideExtension;
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    ext = overrideExtension || extname(newName) || '';

    return `${base}${ext}`;
  }

  createResource(resource: ICdnResource): CdnResource {
    return new CdnResource(resource);
  }

  //TODO: This needs work
  static async fetch(
    url: string,
    opts?: any,
    integration?: CdnIntegration
  ): Promise<{ data: Buffer; mimeType: string; size: number }> {
    // TODO: Probaby don't need this, can directly go to CDN
    if (url.indexOf('/fid/') === 0 && integration != null) {
      // @ts-ignore
      return this.getByFid(url.replace('/fid/', ''), integration);
    }

    console.warn('Fetching from external URL', url);

    const result = await axios.get(url, {
      // @ts-ignore
      responseType: 'arraybuffer',
      ...opts
    });

    return {
      data: Buffer.from(result.data, 'binary'),
      mimeType: result.headers['content-type'],
      size: parseInt(result.headers['content-length'], 10)
    };
  }

  getCdnUrl(ticket: ICdnTicket): string {
    return '/fid/' + ticket.fid;
  }
}

export {
  CdnIntegration,
  CdnResource,
  type ICdnIntegrationConfig,
  type ICdnTicket,
  type ICdnResource,
  type ICDNFidServeOpts,
  EOmniFileTypes
};
