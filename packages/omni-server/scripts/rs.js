/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import {omnilog} from 'omni-shared';

const script = {
  name: 'rs',
  description: 'Restarts the server',
  exec: async function (ctx, payload) {
    await ctx.app.sendMessageToSession(ctx.session.sessionId, 
      '⚠️ The server is restarting, please wait. ⚠️', 
      'text/plain');

    // Brief pause to allow message and result to be sent

    setTimeout(() => {
      omnilog.log('Forcing app restart...');
      // Invoke a restart by IPC - only works if launched from launcher.js
      process.send({cmd: 'restart'});
    }, 100);

    return {
      result: { ok: true }
    }    
  }
}

export default script
