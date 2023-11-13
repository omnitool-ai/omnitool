/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { Socket } from 'rete';
import { type WorkerContext, type ICustomSocketOpts } from '../openapi/types';

abstract class CustomSocket extends Socket {
  public type: string;

  protected opts: ICustomSocketOpts;

  protected customActions = new Map<string, Function>();

  constructor(name: string, type: string, opts?: ICustomSocketOpts) {
    super(name, opts);
    this.opts = opts || {};
    this.type = type;
  }
  abstract handleInput(ctx: WorkerContext, data: any): Promise<any | null>;
  abstract handleOutput(ctx: WorkerContext, data: any): Promise<any | null>;

  get format() {
    return this.opts.format;
  }

  get array() {
    return this.opts.array || false;
  }

  get customAction() {
    return this.opts.customAction;
  }

  get customSettings() {
    return this.opts.customSettings;
  }

  compatibleWith(socket: Socket, noReverse = false) {
    if (noReverse) return super.compatibleWith(socket);
    // Flip this to have input check compatibility
    //@ts-ignore
    return socket.compatibleWith(this, true);
  }

  isValidUrl(str: string): boolean {
    let url;

    if (!(typeof str === 'string' && str.length > 0)) {
      return false;
    }

    try {
      url = new URL(str);
    } catch (e) {
      return false;
    }

    return url.protocol === 'http:' || url.protocol === 'https:';
  }
}

export default CustomSocket;
