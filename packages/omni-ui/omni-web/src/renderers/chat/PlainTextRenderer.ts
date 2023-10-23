/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';
import DOMPurify from 'dompurify';
import { escapeHtmlSpecialChars } from '../../utils';

// An extension to render sanitized plain text in a chat message

class PlainTextRenderer extends ChatRenderer {
  constructor(id?: string, opts?: any) {
    super({ id: id ?? 'text/plain' }, opts);
  }

  render(content: { type: string; value: any }): string {
    const text = Array.isArray(content.value) ? content.value.join('\n') : content.value?.toString();
    return DOMPurify.sanitize(escapeHtmlSpecialChars(text)).replace(/\n/g, '<br/>');
  }
}

export default PlainTextRenderer;
