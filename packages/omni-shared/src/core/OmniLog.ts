/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import consola, { type ConsolaReporter } from 'consola';

enum OmniLogLevels {
  silent = Number.NEGATIVE_INFINITY,
  always = 0,
  fatal = 0,
  warning = 1,
  normal = 2,
  info = 3,
  debug = 4,
  trace = 5,
  verbose = Number.POSITIVE_INFINITY
}

const DEFAULT_LOG_LEVEL = OmniLogLevels.normal;

class OmniLog {
  public static _instance: OmniLog = new OmniLog();

  // PRIORITY MESSAGES
  // only time we override priority/always logger is OmniLogLevels.silent
  // these are for messages we want to show regardless of logging levels
  private readonly _status_priority: any = consola.create({ level: OmniLogLevels.verbose });

  private readonly _void: (_msg: string) => void = (_msg: string) => {};
  private readonly __log: (_msg: string) => void = (msg: string) => {
    consola.log(msg);
  };
  private _log: (_msg: string) => void = DEFAULT_LOG_LEVEL >= OmniLogLevels.info ? this.__log : this._void;

  private readonly _customLevel: Map<string, number>;

  private constructor() {
    if (OmniLog._instance !== undefined) {
      throw new Error('Log instance duplicate error');
    }
    consola.level = DEFAULT_LOG_LEVEL;
    this._customLevel = new Map<string, number>();
    OmniLog._instance = this;
  }

  get level(): number {
    return consola.level;
  }
  set level(value: number) {
    this._status_priority.level = value < 0 ? value : OmniLogLevels.verbose;
    this._log = value >= OmniLogLevels.info ? this.__log : this._void;
    consola.level = value;
    if (value < 0) {
      // eslint-disable-next-line space-in-parens, block-spacing
      this._customLevel.forEach((e) => {
        e = OmniLogLevels.silent;
      });
    }
  }

  get warn(): (...input: any[]) => any {
    return consola.warn;
  }
  get error(): (...input: any[]) => any {
    return consola.error;
  }
  get info(): (...input: any[]) => any {
    return consola.info;
  }
  get debug(): (...input: any[]) => any {
    return consola.debug;
  }
  get verbose(): (...input: any[]) => any {
    return consola.verbose;
  }
  get ready(): (...input: any[]) => any {
    return consola.ready;
  }
  get success(): (...input: any[]) => any {
    return consola.success;
  }
  get trace(): (...input: any[]) => any {
    return consola.trace;
  }
  get log(): (...input: any[]) => any {
    return this._log;
  }
  get assert(): (...input: any[]) => any {
    return console.assert;
  }

  status_start(msg: string) {
    this._status_priority.start(msg);
  }
  status_success(msg: string) {
    this._status_priority.success(msg);
  }
  status_fail(msg: string) {
    this._status_priority.fail(msg);
  }

  access(msg: string) {
    this._status_priority.trace(msg);
  }

  createWithTag(id: string) {
    return consola.withTag(id);
  }
  wrapConsoleLogger(): void {
    consola.wrapConsole();
  }
  restoreConsoleLogger(): void {
    consola.restoreConsole();
  }

  setCustomLevel(id: string, level: number): void {
    this._customLevel.set(id, level);
  }
  getCustomLevel(id: string): number {
    return this._customLevel.get(id) ?? DEFAULT_LOG_LEVEL;
  }

  addConsolaReporter(reporter: ConsolaReporter) {
    consola.addReporter(reporter);
    this._status_priority.addReporter(reporter);
  }
  removeConsolaReporter(reporter: ConsolaReporter) {
    consola.removeReporter(reporter);
    this._status_priority.removeReporter(reporter);
  }
}
const omnilog = OmniLog._instance;

export function registerOmnilogGlobal() {
  // @ts-ignore
  if (globalThis) {
    // @ts-ignore
    globalThis.omnilog = omnilog;
  }
}

export { omnilog, OmniLogLevels, type OmniLog };
