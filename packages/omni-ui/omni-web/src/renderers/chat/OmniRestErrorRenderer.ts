/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';

// A chat extension to render a onmitool rest error object

class OmniRestErrorRenderer extends ChatRenderer {
  constructor(id?: string, opts?: any) {
    super({ id: id ?? 'omni/rest-error' }, opts);
  }

  render(content: { type: string; value: any }): string {
    const error: { component: string; message: string } = content.value;

    const getErrorDetails = function (message: any) {
      let errorObj = message;
      if (typeof message === 'string') {
        try {
          errorObj = JSON.parse(message);
        } catch (e) {}
      } else if (typeof error === 'object') {
        errorObj = message;
      }

      return JSON.stringify(errorObj, null, 2);
    };

    return (
      "<div class='w-full text-red-500 font-semibold'>❌ Error</div><div>Component Key: <span class='font-mono text-red-500'>" +
      (error.component || '') +
      "</div><div>Error Details: <pre class='font-mono text-red-500' style='white-space: pre-wrap;'>" +
      getErrorDetails(error.message) +
      '</pre></div>'
    );
  }
}

export default OmniRestErrorRenderer;
