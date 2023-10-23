/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type Socket } from 'rete';
import CustomSocket from './CustomSocket';
import { type WorkerContext } from '../openapi/types';

// Custom Settings

// array_separator - used for join and split operations when handling arrays. Default: '\n'
// null_value - used for null values. Default: ''

class TextSocket extends CustomSocket {
  override compatibleWith(socket: Socket, noReverse: boolean): boolean {
    const cs: Partial<CustomSocket> = this;

    if (cs.type) {
      return ['string', 'object', 'number', 'integer', 'float', 'file', 'image', 'audio', 'document', 'text'].includes(
        cs.type
      );
    } else {
      return socket instanceof TextSocket;
    }
  }

  convertSingleValue(value: any): string {
    if (value == null || value === undefined) {
      return this.customSettings?.null_value || '';
    }

    if (typeof value === 'object') {
      if (value instanceof Date) {
        return value.toISOString();
      }
      // Omnitool Fids
      else if (value.fid && value.furl) {
        return value.furl;
      } else {
        return JSON.stringify(value, null, 2);
      }
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    return JSON.stringify(value, null, 2);
  }

  async handleInput(ctx: WorkerContext, value: any): Promise<any | null> {
    const arraySeparator = this.customSettings?.array_separator ?? '\n';

    if (this.array && typeof value === 'string') {
      value = value.split(arraySeparator);
    }

    if (!Array.isArray(value)) {
      value = [value];
    }

    value = value.map(this.convertSingleValue.bind(this));

    if (this.customSettings?.filter_empty) {
      value = value.filter((v: string) => v);
    }

    return this.array ? value : value.join(arraySeparator);
  }

  async handleOutput(ctx: WorkerContext, value: any): Promise<any | null> {
    return await this.handleInput(ctx, value); // Use the same logic for input and output.
  }
}

export default TextSocket;
