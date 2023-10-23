/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';

class OmniExtensionListRenderer extends ChatRenderer {
  // opts: https://marked.js.org/using_advanced
  constructor(opts?: NonNullable<object>) {
    opts ??= {};
    super({ id: 'omni/extension-list' }, opts);
  }

  async load(): Promise<void> {}

  render(content: { type: string; value: any }): string {
    const extensionList = content.value;
    const comp = `<div x-data='{extensionList: ${JSON.stringify(
      extensionList
    )}}'><ul><b>Core Extensions</b>:<template x-for="(extension, idx) in extensionList['core']" :key='idx'>"<li x-text="extension.title + ' (' + extension.id + ')'"></li>"</template></ul>
    <ul><b>Premium Extensions</b>:<template x-for="(extension, idx) in extensionList['premium']" :key='idx'>"<li x-text="extension.title + ' (' + extension.id + ')'"></li>"</template></ul>
    <ul><b>Known Extensions</b>:<template x-for="(extension, idx) in extensionList['known']" :key='idx'>"<li x-text="extension.title + ' (' + extension.id + ')'"></li>"</template></ul>
    <ul><b>Available Extensions</b>:<template x-for="(extension, idx) in extensionList['available']" :key='idx'>"<li x-text="extension.title + ' (' + extension.id + ')'"></li>"</template></ul></div>`;
    return comp;
  }
}

export default OmniExtensionListRenderer;
