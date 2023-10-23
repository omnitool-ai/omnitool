/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import MarkdownRenderer from './MarkdownRenderer';
import { type MarkedOptions } from 'marked';

class CodeRenderer extends MarkdownRenderer {
  constructor(
    id?: string,
    opts?: { marked?: MarkedOptions; markedEmoji?: { emojis: NonNullable<object>; unicode?: boolean } }
  ) {
    id ??= 'text/markdown-code';
    super(id, opts);
  }

  render(content: { type: string; value: any }): string {
    const wrapCode = (str: string) => `<pre><code>${str}</code></pre>`;

    const text = Array.isArray(content.value)
      ? content.value.map(wrapCode).join('')
      : wrapCode(content.value?.toString() || '');

    return super.render({ type: 'text/markdown', value: text });
  }
}

export default CodeRenderer;
