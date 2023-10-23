/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import DOMPurify from 'dompurify';
import { ChatRenderer } from 'omni-client-services';
import { OAIComponent31 } from 'omni-sockets';

// An extension to render an omnitool component object

class OmniComponentRenderer extends ChatRenderer {
  constructor(id?: string, opts?: any) {
    super({ id: id ?? 'omni/component' }, opts);
  }

  render(content: { type: string; value: any }): string {
    const componentJson = JSON.parse(content.value);

    let component;
    if (componentJson.type === 'OAIComponent31') {
      component = OAIComponent31.fromJSON(componentJson);
    }

    if (!component) {
      //WorkflowComponentRegistry.getSingleton().add([component])
      return `Can not render missing component ${content.value}`;
    }

    return `
      <div class='component block rounded-lg px-4 py-2 text-sm w-full text-gray-500 hover:bg-gray-50 hover:text-gray-700  cursor-pointer'
        x-data='{}' x-tooltip='${component?.name}'
        x-on:click="window.client.runScript('add',['${DOMPurify.sanitize(component.name)}'])">
        <div

          class='font-semibold max-w-md'>${DOMPurify.sanitize(component?.title)}
        </div>

        <div>
        ${DOMPurify.sanitize(component?.description)}</div>

      </div>`;
  }
}

export default OmniComponentRenderer;
