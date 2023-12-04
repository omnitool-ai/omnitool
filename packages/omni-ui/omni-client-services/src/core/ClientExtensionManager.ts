/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { AppExtension, ExtensionManager, type IExtensionConfig } from 'omni-shared';
import type Client from './Client';

interface IClientExtensionConfig extends IExtensionConfig {
  addToWorkbench?: boolean;
  addToSidebar?: true;

  singleton: boolean;
  winbox?: any;
  fileIntents?: {
    show: Record<string, { page: string; opts?: any }>;
    edit: Record<string, { page: string; opts?: any }>;
  };
}

class ClientExtension extends AppExtension {
  commands?: Record<string, { title: string; description: string }>;

  constructor(id: string, manager: ClientExtensionManager, config: IClientExtensionConfig) {
    config.singleton = !!config.singleton;
    super(id, manager, config);
  }

  public get singleton(): boolean {
    return this.extensionConfig.singleton;
  }

  public get winbox(): any {
    return this.extensionConfig.winbox;
  }

  get client(): Client {
    return this.app as Client;
  }

  get extensionConfig(): IClientExtensionConfig {
    return this.config as IClientExtensionConfig;
  }

  get fileIntents():
    | {
        show: Record<string, { page: string; opts?: any }>;
        edit: Record<string, { page: string; opts?: any }>;
      }
    | undefined {
    return this.extensionConfig.fileIntents;
  }

  get pinned(): boolean {
    return (
      this.extensionConfig.addToSidebar === true || (this.extensionConfig.addToWorkbench === true && window.localStorage.getItem(`fav-extension${this.id}`) !== null)
    );
  }

  set pinned(value: boolean) {
    if (value) {
      window.localStorage.setItem(`fav-extension${this.id}`, 'true');
    } else {
      window.localStorage.removeItem(`fav-extension${this.id}`);
    }
  }

  async create() {
    this.debug('create()', this.id);

    if (this.extensionConfig.scripts?.client) {
      for (const scriptId in this.extensionConfig.scripts.client) {
        const script = this.extensionConfig.scripts.client[scriptId];
        try {
          this.info(
            `Deserializing client extension script, id:"${scriptId}", text:`,
            script.length > 60 ? script.slice(0, 40) + '...' : script
          );
          // eslint-disable-next-line no-eval
          const eval2 = eval; // https://esbuild.github.io/content-types/#direct-eval
          const scriptCreator = eval2('(' + JSON.parse(script) + ')');
          const scriptObject = scriptCreator?.();
          if (scriptObject?.exec) {
            this.client.registerClientScript(scriptId, scriptObject.exec);
            this.commands ??= {};
            this.commands[scriptId] = { title: scriptObject.title, description: scriptObject.description };
          }
        } catch (ex: any) {
          this.error('Error registering extension script script', script.id, ex);
        }
      }
    }
  }
}

class ClientExtensionManager extends ExtensionManager {
  constructor(app: Client) {
    super(app);
  }

  get extensions(): Map<string, ClientExtension> {
    return this.children as Map<string, ClientExtension>;
  }

  get(id: string): ClientExtension | undefined {
    return this.extensions.get(id);
  }

  has(id: string): boolean {
    return this.extensions.has(id);
  }

  all(): ClientExtension[] {
    return Array.from(this.extensions.values());
  }

  async register(Ctor: any, config: any, wrapper?: any) {
    this.debug(`registering ${config.id} extensions`);
    let extension = new Ctor(config.id, this, config);
    if (wrapper && typeof wrapper === 'function') {
      extension = wrapper(extension);
    }
    this.children.set(config.id, extension);
    await extension.create?.();
    return extension;
  }

  async init(): Promise<void> {
    // Load extension configurations from the server
    let extensionsConfigurations: any = await fetch('/api/v1/mercenaries/extensions');
    extensionsConfigurations = await extensionsConfigurations.json();

    for (const extensionConfig of extensionsConfigurations) {
      const ext = await this.register(ClientExtension, extensionConfig);

      if (ext.fileIntents) {
        if (ext.fileIntents.show && Object.keys(ext.fileIntents.show).length > 0) {
          for (const mimeType in ext.fileIntents.show) {
            const intent = ext.fileIntents.show[mimeType];
            //@ts-expect-error
            this.app.sdkHost.registerFileIntent('show', mimeType, {
              extensionId: ext.id,
              page: intent.page,
              opts: intent.opts || {}
            });
          }
        }
        if (ext.fileIntents.edit && Object.keys(ext.fileIntents.edit).length > 0) {
          for (const mimeType in ext.fileIntents.edit) {
            const intent = ext.fileIntents.edit[mimeType];
            //@ts-expect-error
            this.app.sdkHost.registerFileIntent('edit', mimeType, {
              extensionId: ext.id,
              page: intent.page,
              opts: intent.opts || {}
            });
          }
        }
      }
    }
  }
}

export { ClientExtension, ClientExtensionManager, type IClientExtensionConfig };
