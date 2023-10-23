/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { Managed, Manager, type App } from '../index';

interface IBlockOrPatchSummary {
  name: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
}

interface IExtensionConfig {
  id: string;
  path: string;
  title: string;
  description?: string;
  scripts?: any;
  client?: any;
  server?: any;
  blocks: IBlockOrPatchSummary[];
  patches: IBlockOrPatchSummary[];
  errors?: string[];
}

class AppExtension extends Managed {
  constructor(id: string, manager: ExtensionManager, config: IExtensionConfig) {
    super(id, manager, config);
  }

  override async emit(event: string, ...data: any) {
    this.verbose(`[Extension.EMIT] ${this.id} emits event '${event}'`);
    await this.app.emit(`${this.id}.${event}`, data);
  }

  get extensionConfig(): IExtensionConfig {
    return this.config as IExtensionConfig;
  }
}

class ExtensionManager extends Manager {
  constructor(app: App) {
    super(app);
  }
}
export { AppExtension, ExtensionManager, type IExtensionConfig, type IBlockOrPatchSummary };
