/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { existsSync } from 'fs';
import { AppExtension, type IExtensionConfig } from 'omni-shared';
import path from 'path';
import { type ServerExtensionManager, type PERMITTED_EXTENSIONS_EVENTS, type KNOWN_EXTENSION_METHODS } from './ServerExtensionsManager';

class ServerExtension extends AppExtension {
  hooks: Record<string, Function> = {}
  methods: Record<string, Function> = {}
  public errors: string[] = [];
  disabled: boolean = false;

  constructor(id: string, manager: ServerExtensionManager, config: IExtensionConfig) {
    // sanitize to alphanumeric, dash and underscore in extension names
    id = id.replace(/[^a-zA-Z0-9-_]/g, '_');
    super(id, manager, config);
    this.errors = config.errors || [];
  }

  get extensionConfig(): IExtensionConfig {
    return this.config as IExtensionConfig;
  }

  create() {
    this.debug('create()', this.id);

    if (this.extensionConfig.server?.hooks != null) {
      for (const hook in this.extensionConfig.server.hooks) {
        this.debug('registering hook', hook);
        this.registerEventHook(hook as PERMITTED_EXTENSIONS_EVENTS, this.extensionConfig.server.hooks[hook]);
      }
    }

    if (this.extensionConfig.server?.methods && typeof this.extensionConfig.server?.methods === 'object') {

      Object.entries(this.extensionConfig.server.methods)
        .filter(([key, value]) => typeof value === 'function')
        .forEach(([key, value]) => {
          this.registerMethod(key as KNOWN_EXTENSION_METHODS, (value as Function));
        });
     
    }
  }

  async stop(): Promise<boolean> {
    this.debug('stop()', this.id);
    return true;
  }

  registerEventHook(event: PERMITTED_EXTENSIONS_EVENTS, handler: Function) {
    this.info('registerEventHook', event);
    if (!this.disabled) {
      this.hooks[event] = handler.bind(this);
    }
  }

  registerMethod(key: KNOWN_EXTENSION_METHODS, handle: Function) {
    this.info('registerMethod', key, handle != null);
    if (!this.disabled) {
      this.methods[key] = handle.bind(this);
    }
  }

  async invokeKnownMethod(method: KNOWN_EXTENSION_METHODS, ctx: any, args: any): Promise<any> {
    if (this.disabled) {
      return;
    }

    if (this.methods[method] === undefined) {
      this.debug('invokeKnownMethod', method, '[ServerExtension] invokeKnownMethod method not found');
      return;
    }

    if (this.methods[method]) {
      this.info('invokeKnownMethods', method, args);
      return await this.methods[method](ctx,args);
    }

    return Promise.resolve()
  }

  async invokeEventHook(ctx: any, event: PERMITTED_EXTENSIONS_EVENTS, args: any[]): Promise<any> {
    if (this.disabled) {
      return;
    }
    if (args === null || args === undefined) {
      this.debug(
        'invokeEventHook',
        event,
        '[ServerExtension] invokeEventHook passed args is null or undefined - setting it to empty array'
      );
      args = [];
    }

    this.info('invokeEventHook', event);
    if (this.hooks[event]) {
      if (args && args[Symbol.iterator]) {
        return await this.hooks[event](ctx, ...args);
      } else {
        return await this.hooks[event](ctx, args);
      }
    }
  }

  hasEventHook(event: string): boolean {
    return this.hooks[event] != null;
  }

  getScriptFile(name: string): string {
    return this.extensionConfig.scripts?.server?.[name];
  }

  getDirectory: () => string = () => {
    return path.join(process.cwd(), 'extensions', this.id);
  };

  onRegisterStatic({ fastifyInstance, fastifyStatic }: any) {
    if (this.disabled) {
      return;
    }
    const publicPath = path.join(this.extensionConfig.path, 'public');
    if (existsSync(publicPath)) {
      // @ts-ignore
      this.manager.verbose('Registering extension static path', this.extensionConfig.id, publicPath);
      fastifyInstance.register(fastifyStatic, {
        root: publicPath,
        prefix: `/extensions/${this.extensionConfig.id}/`,
        decorateReply: false
      });
    } else {
      // @ts-ignore
      this.manager.verbose('No static path for', this.extensionConfig.id, publicPath);
    }
    // @ts-ignore
    this.manager.verbose('Registered extension static path', publicPath);
  }
}

export { ServerExtension };
