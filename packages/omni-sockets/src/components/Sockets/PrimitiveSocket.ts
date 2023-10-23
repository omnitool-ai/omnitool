/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import CustomSocket from './CustomSocket';
import { type WorkerContext } from '../openapi/types';

class PrimitiveSocket extends CustomSocket {
  async handleInput(ctx: WorkerContext, value: any): Promise<any | null> {
    if (Array.isArray(value)) {
      value = value[0]; // If array is passed in, just take the first element.
    }
    return value;
  }

  async handleOutput(ctx: WorkerContext, value: any): Promise<any | null> {
    return await this.handleInput(ctx, value); // Use the same logic for input and output.
  }
}

export default PrimitiveSocket;
