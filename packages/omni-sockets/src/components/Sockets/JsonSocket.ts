/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import CustomSocket from './CustomSocket';
import { type WorkerContext } from '../openapi/types';

class JSONSocket extends CustomSocket {


  async handleSingleValue(ctx: WorkerContext, value: any): Promise<any | null> {

    if (value === null || value === undefined)
    {
      return null
    }
    // If it's already an object, return it
    if (typeof value === 'object')
    {
      return value
    }
    // Try to parse strings as objects
    else if (typeof value === 'string')
    {
      // TODO: Custom socket flag for error behavior may be nice to have.
      try {
        return JSON.parse(value)
      }
      catch (e)
      {
        console.error("Error parsing object socket", e)
        return null
      }
    }
    return value
  }


  async _handlePort(ctx: WorkerContext, value: any): Promise<any | null> {

    const isArray = Array.isArray(value)
    let ret = value
    // If the socket is a single value but the value is an array, take the first value
    if ( isArray && !this.array)
    {
      ret =  value.length > 0 ? value[0] : []
    }
    // If the socket is an array but the value is a single value, wrap it in an array
    else if ( !isArray && this.array)
    {
      ret = [value]
    }

    // If the socket is an array, handle each value individually
    if (Array.isArray(ret))
    {
      let result = await Promise.all(ret.map(async (v: any) => {
        return await this.handleSingleValue(ctx, v)
      }))

      result = result.filter((x) => x != null)

      // empty arrays are reported as 'null' because the system can treat those as empty inputs
      return result.length > 0 ? result : null

    }
    // If the socket is a single value, handle it as a single value
    else
    {
      const result =  await this.handleSingleValue(ctx, ret)
      // empty arrays are reported as 'null' because the system can treat those as empty inputs
      return result != null ? result : null
    }
  }


  async handleInput(ctx: WorkerContext, value: any): Promise<any | null> {
    return await this._handlePort(ctx, value);
  }

  async handleOutput(ctx: WorkerContext, value: any): Promise<any | null> {
    return await this._handlePort(ctx, value);
  }
}

export default JSONSocket;
