/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import CustomSocket from './CustomSocket';
import { type WorkerContext } from '../openapi/types';
import { type Socket } from 'rete';
interface ICdnResource {
  ticket: { fid: string; url: string; publicUrl: string; count?: number };
  fileName: string;
  size: number;
  data?: any;
  url: string;
  furl: string;
  expires?: number;
  mimeType?: string;
  fileType?: string;
  meta: {
    type?: string;
    dimensions?: { width: number; height: number };
    created?: number;
    creator?: string;
  };
}

class FileObjectSocket extends CustomSocket {
  override compatibleWith(socket: Socket, noReverse: boolean): boolean {
    const cs: Partial<CustomSocket> = this;

    if (cs.type) {
      return ['string', 'image', 'audio', 'document', 'file'].includes(cs.type);
    } else {
      return socket instanceof FileObjectSocket;
    }
  }

  detectMimeType(ctx: WorkerContext, value: any): string | undefined {
    return undefined;
  }

  async persistObject(ctx: WorkerContext, value: any, opts?: any): Promise<ICdnResource> {
    if ((value.ticket || value.fid) && value.url && !value.data) {
      // If we don't have data, it means we are already persisted
      return await Promise.resolve(value);
    }

    opts ??= {};
    opts.mimeType ??= this.detectMimeType?.(ctx, value);

    const finalOpts = { userId: ctx.userId, jobId: ctx.jobId, ...opts };
    return ctx.app.cdn.putTemp(value, finalOpts) as ICdnResource;
  }

  async persistObjects(ctx: WorkerContext, value: any, opts?: any): Promise<ICdnResource[]> {
    return await Promise.all(
      value.map(async (v: any) => {
        return await this.persistObject(ctx, v);
      })
    );
  }

  protected async _inputFromString(ctx: WorkerContext, value: any): Promise<ICdnResource[]> {
    if (typeof value !== 'string') {
      return value;
    }

    const objects = value.split('\n');
    const ret = objects.map((x) => x.trim()).filter((x) => x.length);
    return await Promise.all(
      ret.map(async (v: string) => {
        return await this.persistObject(ctx, v);
      })
    );
  }

  private async _handleSingleObject(
    ctx: WorkerContext,
    value: any,
    getValue: boolean = false
  ): Promise<ICdnResource | string | null> {
    if (!value) {
      return null;
    }

    // if we need to convert to base64, do it by pulling the data.
    else if (value.fid && !value.data && getValue && this.format?.startsWith('base64')) {
      value = await ctx.app.cdn.get({ fid: value.fid }, null, this.format);
    }
    // input socket that doesn't need to be base64 actually doesn't need to do anything if it already has a fid
    else if (this.isValidUrl(value)) {
      value = await this.persistObject(ctx, value.trim());
    } else if (value?.startsWith?.('fid://') && !this.format?.startsWith('base64')) {
      const {fid, extension} = value.split('://')[1].split('.');
      value = await ctx.app.cdn.get({ fid }, null, this.format);
    }
    // If input is anything else, try to persist it
    else if (value && !value.url) {
      value = await this.persistObject(ctx, value);
    }

    // Handle base64 headers
    if (value && this.format?.startsWith('base64')) {
      const addHeader = this.format?.includes('withHeader');
      if (value.asBase64) {
        value = value.asBase64(addHeader); // Use `asBase64` method supplied
      } else if (value.data instanceof Buffer) {
        if (addHeader) {
          value = `data:${value.mimeType};base64,${value.data.toString('base64')}`;
        } else {
          value = value.data.toString('base64');
        }
      } else if (typeof value.data === 'string') {
        value = value.data;
      }
    }

    // wipe data if needed
    if (this.customSettings?.do_no_return_data) {
      delete value.data;
    } else {
      // If we need to get the data, do it
      if (getValue && typeof value === 'object' && !value.data) {
        value = await ctx.app.cdn.get({ fid: value.fid }, null, this.format);
      }
    }

    return value as ICdnResource | string;
  }

  private async _handleObjectArray(
    ctx: WorkerContext,
    value: any[],
    getValue: boolean = false
  ): Promise<ICdnResource[] | null> {
    if (!value) {
      return null;
    }

    if (!Array.isArray(value)) {
      value = [value];
    }

    value = value.filter((x) => x !== null);

    return (await Promise.all(
      value.map(async (v: any) => {
        return await this._handleSingleObject(ctx, v, getValue);
      })
    )) as ICdnResource[];
  }

  async _handlePort(
    ctx: WorkerContext,
    value: any,
    getValue: boolean
  ): Promise<ICdnResource[] | ICdnResource | string | null> {
    value = await this._inputFromString(ctx, value);

    if (!Array.isArray(value)) {
      value = [value];
    }

    if (this.array) {
      return await this._handleObjectArray(ctx, value, getValue);
    }
    return await this._handleSingleObject(ctx, value[0], getValue);
  }

  async handleInput(ctx: WorkerContext, value: any): Promise<ICdnResource[] | ICdnResource | string | null> {
    return await this._handlePort(ctx, value, true);
  }

  async handleOutput(ctx: WorkerContext, value: any): Promise<ICdnResource[] | ICdnResource | string | null> {
    // Don't get data on output, any input port will get data as needed
    return await this._handlePort(ctx, value, false);
  }
}

export default FileObjectSocket;
