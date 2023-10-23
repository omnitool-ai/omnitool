/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';

// An extension to render markdown in a chat message

class OmniBillingTabRenderer extends ChatRenderer {
  constructor(opts?: NonNullable<unknown>) {
    opts ??= {};
    super({ id: 'omni-pro-billing/tab' }, opts);
  }

  async load(): Promise<void> {}

  render(content: { type: string; value: any }): string {
    // TODO: [security] Filter all strings for XSS
    const comp = `<div x-data='${JSON.stringify(content.value)}'>
      <div x-show='true' class=' bg-gray-300 m-1 pb-1 font-mono'>
        <div class="font-bold text-center bg-gray-700 mb-2 text-gray-100" >
        <span> </span><span x-text='jobId' >          </span>
        </div>
        <div class="flex-row w-full flex-wrap">
        <template x-for='(record,idx) in tab' :key="idx">
            <div class=' flex-row gap-1 w-full flex text-xs  pl-1'> <span x-text="idx+1"></span>.<span x-text="record.api?.toUpperCase()"></span> (<span x-text="record.model"></span>)<span class="flex-grow"></span> <span x-text="record.resource"></span>&nbsp; <span class='text-right' x-text="record.cost?.toFixed(5)"></span>  </div>
        </template>
        <div class='text-xs  pl-1 text-right'>💰 TOTAL: <span x-text="total.toFixed(5)"></span></div>
        </div>
      </div> `;
    return comp;
  }
}

export default OmniBillingTabRenderer;
