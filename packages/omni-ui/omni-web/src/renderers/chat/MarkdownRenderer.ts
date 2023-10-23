/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';
import DOMPurify from 'dompurify';
import { marked, type MarkedOptions } from 'marked';
import { markedEmoji } from 'marked-emoji';

// An extension to render markdown in a chat message

class MarkdownRenderer extends ChatRenderer {
  // opts: https://marked.js.org/using_advanced
  constructor(
    id?: string,
    opts?: { marked?: MarkedOptions; markedEmoji?: { emojis: NonNullable<object>; unicode?: boolean } }
  ) {
    opts ??= {};
    opts.marked ??= { mangle: false, gfm: true, breaks: true, headerIds: false, headerPrefix: undefined };
    opts.markedEmoji ??= { unicode: true, emojis: { emojis: { fire: '🔥', heart: '❤️', thumbsup: '👍' } } };
    super({ id: id ?? 'text/markdown' }, opts);
  }

  async load(): Promise<void> {
    marked.use(markedEmoji(this.opts.markedEmoji));
  }

  render(content: { type: string; value: any }): string {
    // Convert content.value to string
    // If it's an array, join it using Markdown paragraph breaks
    const text = Array.isArray(content.value) ? content.value.join('\n\n') : content.value?.toString();
    const markdownWithHtml = marked.parse(text, { mangle: false, headerIds: false });
    const sanitizedHtml = DOMPurify.sanitize(markdownWithHtml, {
      ALLOWED_TAGS: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'p',
        'a',
        'ul',
        'ol',
        'nl',
        'li',
        'b',
        'i',
        'strong',
        'em',
        'strike',
        'code',
        'hr',
        'br',
        'div',
        'table',
        'thead',
        'caption',
        'tbody',
        'tr',
        'th',
        'td',
        'pre',
        'img'
      ],
      ALLOWED_ATTR: ['href', 'alt', 'src', 'title']
    });

    return sanitizedHtml;
  }
}

export default MarkdownRenderer;
