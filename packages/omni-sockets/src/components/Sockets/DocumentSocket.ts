/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import FileObjectSocket from './FileObjectSocket';
import { type WorkerContext } from '../openapi/types';
import { type Socket } from 'rete';

class DocumentSocket extends FileObjectSocket {
  // Try to guess if we have a plain text
  mightBeUtf8PlainText(text: string): boolean {
    const thresholdPercentage = 0.05;
    const maxControlChars = text.length * thresholdPercentage;
    let controlCharCount = 0;

    for (const char of text) {
      const charCode = char.charCodeAt(0);

      if ((charCode >= 0x0000 && charCode <= 0x001f) || (charCode >= 0x007f && charCode <= 0x009f)) {
        controlCharCount++;

        if (controlCharCount > maxControlChars) {
          return false;
        }
      }
    }

    return true;
  }

  override detectMimeType(ctx: WorkerContext, value: any): string | undefined {
    if (value && typeof value === 'string') {
      if (this.mightBeUtf8PlainText(value)) {
        return 'text/plain';
      }
    }
    return undefined;
  }

  override compatibleWith(socket: Socket, noReverse: boolean): boolean {
    const cs: Partial<FileObjectSocket> = this;

    if (cs.type) {
      return ['string', 'text', 'document'].includes(cs.type);
    }
    return socket instanceof DocumentSocket;
  }
}

export default DocumentSocket;
