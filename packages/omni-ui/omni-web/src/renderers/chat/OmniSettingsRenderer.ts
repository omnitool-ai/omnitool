/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';

class OmniSettingsRenderer extends ChatRenderer {
  constructor(opts?: NonNullable<object>) {
    opts ??= {};
    super({ id: 'omni/settings' }, opts);
  }

  async load(): Promise<void> {}

  render(content: { type: string; value: any }): string {
    const comp = `
    <div>

        <div class="flex-row w-full flex-wrap">
          <template x-for='(value,key) of window.client.${content.value}' :key="key">
            <div class=' flex-row gap-1 w-full flex text-xs  pl-1'> <span x-text="key"></span>: <span x-text="value"></span></div>
           </template>

    </div> `;
    return comp;
  }
}

export default OmniSettingsRenderer;
