/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import FileObjectSocket from './FileObjectSocket';
import { type Socket } from 'rete';

class AudioSocket extends FileObjectSocket {
  override compatibleWith(socket: Socket, noReverse: boolean): boolean {
    const cs: Partial<FileObjectSocket> = this;

    if (cs.type) {
      return ['string', 'file', 'audio'].includes(cs.type);
    }
    return socket instanceof AudioSocket;
  }
}

export default AudioSocket;
