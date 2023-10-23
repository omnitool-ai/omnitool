/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import CustomSocket from './CustomSocket';
import { type WorkerContext } from '../openapi/types';
import { type Socket } from 'rete';

class AnySocket extends CustomSocket {
  override compatibleWith(socket: Socket, noReverse: boolean): boolean {
    return true;
  }

  async handleInput(ctx: WorkerContext, value: any): Promise<any | null> {
    return value;
  }

  async handleOutput(ctx: WorkerContext, value: any): Promise<any | null> {
    return value;
  }
}

export default AnySocket;
