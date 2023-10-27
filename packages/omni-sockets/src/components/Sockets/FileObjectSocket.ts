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
        return await this.persistObject(ctx, v, opts);
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
 
    let cdnResource = null
    const format = this.format?.includes('base64') ? 'base64' : undefined
    const addHeader = format && this.format?.includes('withHeader')

    // Case 1: We have an object with a fid:
    if (value.fid)
    {
      // If it's base64, we always have to pull data to convert it
      if (!getValue  && format !== 'base64')
      {
        cdnResource = await ctx.app.cdn.find(value.fid)
      }
      else
      {
        cdnResource = await ctx.app.cdn.get(value, null, format)        
      }
    }
    else if (value instanceof Buffer)
    {
      cdnResource = await this.persistObject(ctx, value)      
    }
    else if (typeof value === 'string')
    {
      if ( this.isValidUrl(value))
      {
        cdnResource = await this.persistObject(ctx, value.trim());
      }
      else if (value?.startsWith?.('fid://'))
      {
        const [fid, extension] = value.split('://')[1].split('.');
        cdnResource = await ctx.app.cdn.get({ fid }, null, format);
      }
      else (value.length>0)
      {     
        cdnResource = await this.persistObject(ctx, value);      
      }
    }

    let socketValue = null
    
    if (cdnResource && cdnResource.fid)
    {
      if (format === "base64")
      {
        
        socketValue = cdnResource.asBase64(addHeader)       
      }
      else
      {
        socketValue = cdnResource
      }
    }
    else
    {
      console.error("File socket: Failure to process value", value)
    }
    

    // wipe data if needed
    if (socketValue !== null && this.customSettings?.do_no_return_data  && format !== 'base64') {
      delete socketValue.data;
    } 

    return socketValue 
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
