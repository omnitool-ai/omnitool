/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type ConsolaReporter, type ConsolaOptions, type LogObject } from 'consola';
import { type DBService } from '../DBService.js';
import { format } from 'node:util';

export class DBLoggingReporter implements ConsolaReporter {
  db?: DBService;

  constructor(db: DBService) {
    this.db = db;
  }

  parseStack(stack: string) {
    return stack.split('\n').slice(7);
  }

  formatStack(stack: string) {
    return '  ' + this.parseStack(stack).join('\n  ');
  }

  log(logObj: LogObject, ctx: { options: ConsolaOptions }) {
    if (!this.db) {
      return;
    }

    let logMsg = format(logObj.args) + '\n';
    if (logObj.type === 'trace') {
      const _err = new Error('Trace:');
      logMsg += this.formatStack(_err.stack ?? '');
    }

    this.db?.flushLog(logObj.type, logMsg, logObj.tag).catch((err) => {
      console.log('Error flushing log to DB: ' + JSON.stringify(err), logObj.type);
    });
  }
}
