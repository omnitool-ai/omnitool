/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import CustomSocket from './CustomSocket';
import { type WorkerContext } from '../openapi/types';

class NumberSocket extends CustomSocket {
  override compatibleWith(socket: CustomSocket, noReverse: boolean): boolean {
    const cs: Partial<CustomSocket> = this;

    if (cs.type) {
      return ['integer', 'number', 'float'].includes(cs.type);
    }
    return socket instanceof CustomSocket;
  }

  async handleInput(ctx: WorkerContext, value: any): Promise<any | null> {
    if (Array.isArray(value)) {
      value = value[0]; // If array is passed in, just take the first element.
    }
    if (!value) {
      // e.g. undefined or [], which would otherwise be NaN.
      return 0;
    }
    if (value === 'inf') {
      return Infinity;
    }
    if (value === '-inf') {
      return -Infinity;
    }
    if (value === 'nan') {
      return NaN;
    }

    if (typeof value !== 'number') {
      return Number(value); // Use JavaScript's built-in conversion.
    }
    return value;
  }

  async handleOutput(ctx: WorkerContext, value: any): Promise<any | null> {
    return await this.handleInput(ctx, value); // Use the same logic for input and output.
  }
}

export default NumberSocket;
