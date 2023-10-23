/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import FileObjectSocket from './FileObjectSocket';
import { type Socket } from 'rete';

class ImageSocket extends FileObjectSocket {
  override compatibleWith(socket: Socket, noReverse: boolean): boolean {
    const cs: Partial<FileObjectSocket> = this;

    if (cs.type) {
      return ['string', 'file', 'image'].includes(cs.type);
    }
    return socket instanceof ImageSocket;
  }
}

export default ImageSocket;
