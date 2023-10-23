/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';

// An extension to render markdown in a chat message

class OmniComponentMetaRenderer extends ChatRenderer {
  // opts: https://marked.js.org/using_advanced
  constructor(opts?: NonNullable<object>) {
    opts ??= {};
    super({ id: 'omni/component-meta' }, opts);
  }

  async load(): Promise<void> {}

  render(content: { type: string; value: any }): string {
    let text = '';
    if (content.value?.source) {
      // TODO: [security] Filter all strings for XSS
      text = `
        <div x-data='${JSON.stringify(content.value)}'>
          <div x-show='title' class="font-bold text-center bg-gray-700 mb-2 text-gray-100" >
            <span x-text='title' ></span>
          </div>
          <div x-show='source' class=' bg-gray-300 m-1 pb-1 font-mono'>
            <div class="font-bold text-center bg-gray-700 mb-2 text-gray-100" >
              <span x-text='source?.title' ></span>
            </div>

            <div class='text-xs pl-2'>
              <div x-show='source?.authors'>
                <span class='font-semibold'>Authors: </span>
                <span  x-text='source?.authors?.join?.(", ")||source?.authors'></span>
              </div>
            </div>
            <p class='text-xs mt-1 mb-2 pl-2' x-text='source?.summary || "No Summary Available"'></p>
            <template x-for='(linkUrl,linkName) in source?.links' :key="linkName">
                <div class='text-xs  pl-1'>🔗<a class='text-blue-600  font-semibold cursor-pointer hover:text-blue-800'' :href='linkUrl' x-text='linkName' target='_blank' ></a></div>
            </template>
          </div>
        </div>`;
    } else {
      text = `
        <div x-data='${JSON.stringify(content.value)}'>
          <div x-show='title' class="font-bold text-center bg-gray-700 mb-2 text-gray-100" >
            <span x-text='title'></span>
          </div>
          <div class=' bg-gray-300 m-1 pb-1 font-mono'>
            <p class='text-xs mt-1 mb-2  pl-2 ' x-text='"No meta info available"'></p>
          </div>
        </div>
      `;
    }

    // const escapedContent = escapeHtmlSpecialChars(text);
    // const sanitizedHtml =  DOMPurify.sanitize(escapedContent);

    return text;
  }
}

export default OmniComponentMetaRenderer;
