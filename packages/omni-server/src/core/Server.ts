/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//  ----------------------------------------------------------------------------------------------
//  Server.ts
//
//    Purpose: This is the main server class. It subclasses the omni-shared app framework
//             and adds features specific to the backend server
//  ----------------------------------------------------------------------------------------------

import { type OptionValues } from 'commander';
import { type CdnIntegration } from 'integrations/CdnIntegrations/CdnIntegration.js';
import {
  App,
  Settings,
  type IAppEvents,
  type ISetting,
  OmniSSEMessages,
  type IOmniSSEMessageClientToast
} from 'omni-shared';
import { MarkdownEngine } from 'omni-sdk';
import { performance } from 'perf_hooks';
import { type JobControllerService } from 'services/JobController/JobControllerService.js';
import { type MessagingServerService } from 'services/MessagingService.js';
import { KVStorage, type IKVStorageConfig } from './KVStorage.js';
import { ServerExtensionManager } from './ServerExtensionsManager.js';
import { ServerIntegrationsManager } from './ServerIntegrationsManager.js';
import { nsfwCheck, initializeModel } from './NSFWCheck.js';

import tar from 'tar';
import { randomBytes } from '../helper/utils.js';
import { BlockManager } from './BlockManager.js';
import { StorageAdapter } from './StorageAdapter.js';
import { URLValidator } from './URLValidator.js';

class MercsServer extends App implements IAppEvents {
  public kvStorage?: KVStorage;
  public api2: {};
  public extensions: ServerExtensionManager;
  private readonly _startTime: number = 0;
  private shutdown: boolean = false;
  public options: OptionValues;
  public blocks: BlockManager;
  public nsfwCheck: Function = nsfwCheck;
  public urlValidator: URLValidator;

  public sdkHost: {
    MarkdownEngine: typeof MarkdownEngine;
  };

  public settings: Settings;

  constructor(id: string, config: any, options: OptionValues) {
    config = config || {};
    config.logger ??= { level: 4 };
    super(id, config, { integrationsManagerType: ServerIntegrationsManager });
    this.options = options || {};
    this.api2 = {};
    this.extensions = new ServerExtensionManager(this);
    this._startTime = performance.now();
    this.blocks = new BlockManager(this, config.blockmanager);
    this.settings = new Settings();
    this.urlValidator = new URLValidator(this);
    this.sdkHost = {
      MarkdownEngine
    };
  }

  async stop(): Promise<boolean> {
    this.kvStorage?.inc('m.server.stop.count');
    await this.extensions.stop();
    await this.blocks.stop();
    await super.stop();
    await this.kvStorage?.stop();
    return true;
  }

  get utils() {
    return { tar };
  }

  async init() {
    // ------------------------ SIGINT CAPTURE ----------------------------------------------------
    const self = this;

    process.on('SIGINT', async function () {
      if (self.shutdown) {
        omnilog.log('Already shutting down, patience');
        return;
      }
      self.shutdown = true;
      omnilog.log('\nSIGINT received, terminating (Ctrl+C)');

      const killProc = setTimeout(async function () {
        await self.kvStorage?.stop();
        omnilog.log('Not shut down after 5 seconds, terminating with extreme prejudice');
        process.exit();
      }, 5000);

      await self.stop();
      clearTimeout(killProc);
      process.exit();
    });

    // ------------------------ Startup: Init extensions -------------------------------------------

    const config = this.config.kvStorage as IKVStorageConfig;
    if (config) {
      this.kvStorage = new KVStorage(this, config);
      if (!(await this.kvStorage.init())) {
        throw new Error('KVStorage failed to start');
      }
      await this.kvStorage.vacuum();
    } else {
      this.warn('No KVStorage config found, server will run without persistent storage');
    }
    this.kvStorage?.inc('m.server.init.count');
    await this.urlValidator.init();
    await this.blocks.init();
    await this.extensions.init();
    this.info('Initializing NSFW.js detection model');
    await initializeModel();
    this.success('---------------------------- INIT COMPLETE ---------------------------------');
  }

  async initGlobalSettings() {
    let settingsStore = null;
    const settingStoreConfig = this.config.settings?.kvStorage;
    if (settingStoreConfig) {
      settingsStore = new KVStorage(this, settingStoreConfig);
      if (!(await settingsStore.init())) {
        throw new Error('Settings KVStorage failed to start');
      }
      await settingsStore.vacuum();
    } else {
      this.warn('No settings store configured, using in-memory store');
    }

    this.settings.bindStorage(
      new StorageAdapter<ISetting<any>>('settings:', settingsStore ?? new Map<string, ISetting<any>>())
    );

    const resetDB = this.options.resetDB;
    let resetSetting = false;
    if (resetDB?.split(',').includes('settings')) {
      this.info('Re-configuring server settings');
      resetSetting = true;
    }

    if (resetSetting) {
      this.settings.delete('omni:api.fetch.policy.url.type');
      this.settings.delete('omni:api.fetch.policy.url.list');
      this.settings.delete('omni:api.fetch.policy.content-type');
    }

    this.settings.add({
      key: 'omni:feature.permission',
      defaultValue: true,
      value: true
    });

    const sessionSecret = randomBytes(32);
    this.settings.add({
      key: 'omni:network.session.secret',
      defaultValue: sessionSecret,
      value: sessionSecret
    });

    const jwtSecret = randomBytes(32);
    this.settings.add({
      key: 'omni:auth.jwt.secret',
      defaultValue: jwtSecret,
      value: jwtSecret
    });

    // Google's oauth client ids and secrets. Move this to extensions?
    this.settings.add({
      key: 'omni:api.oauth.google-tts.client.id',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-tts.client.secret',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-translate.client.id',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-translate.client.secret',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-play.client.id',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-play.client.secret',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-llm.client.id',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-llm.client.secret',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-vision.client.id',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-vision.client.secret',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-gmail.client.id',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.oauth.google-gmail.client.secret',
      defaultValue: '',
      value: ''
    });

    this.settings.add({
      key: 'omni:api.fetch.policy.url.type',
      defaultValue: 'deny_all_except',
      value: 'deny_all_except'
    });

    const listenOn = new URL('http://0.0.0.0:1688');
    listenOn.hostname = this.options.listen;
    listenOn.protocol = this.options.secure ? 'https' : 'http';
    listenOn.port = this.options.port;

    this.settings.add({
      key: 'omni:api.fetch.policy.url.list',
      defaultValue: [listenOn.host],
      value: [listenOn.host]
    });

    this.settings.add({
      key: 'omni:api.fetch.policy.content-type',
      defaultValue: [],
      value: []
    });
  }

  async onLoad(): Promise<boolean> {
    this.kvStorage?.inc('m.server.load.count');
    this.info('Server load completed in ' + (performance.now() - this._startTime).toFixed() + 'ms');
    this.success('---------------------------- LOAD COMPLETE ---------------------------------');
    await this.emit('server_loaded', this);
    return true;
  }

  async onStart(): Promise<boolean> {
    this.kvStorage?.inc('m.server.start.count');
    this.info('Server start completed in ' + (performance.now() - this._startTime).toFixed() + 'ms');
    this.success('---------------------------- START COMPLETE ---------------------------------');
    return true;
  }

  async onStop(): Promise<boolean> {
    //this.kvStorage?.inc('m.server.stop.count') // kvStorage should already be stopped at this point.
    this.info('Server shut down after ' + ((performance.now() - this._startTime) / (1000 * 60)).toFixed(2) + 'minutes');
    this.success('---------------------------- STOP COMPLETE ---------------------------------');
    return true;
  }

  get io(): MessagingServerService {
    return this.services.get('messaging') as unknown as MessagingServerService;
  }

  get cdn(): CdnIntegration {
    return this.integrations.get('cdn') as unknown as CdnIntegration;
  }

  get jobs(): JobControllerService {
    return this.services.get('jobs') as unknown as JobControllerService;
  }

  async sendErrorToSession(
    session: string,
    message: string,
    type: string = 'text/markdown',
    attachments: any = {},
    flags?: string[]
  ) {
    flags ??= [];
    if (!flags.includes('error')) {
      flags.push('error');
    }
    await this.sendMessagesToSession(session, [{ message, type }], attachments, flags);
  }

  async sendMessageToSession(
    session: string,
    message: string,
    type: string = 'text/markdown',
    attachments: any = {},
    flags?: string[],
    nickname?: string
  ) {
    await this.sendMessagesToSession(session, [{ message, type }], attachments, flags, nickname);
  }

  async sendToastToUser(user: string, toast: { message: string; options: any }) {
    const packet: IOmniSSEMessageClientToast = {
      type: OmniSSEMessages.CLIENT_TOAST,
      body: { ...toast }
    };
    return this.io.sendUser(user, packet);
  }

  async sendMessagesToSession(
    session: string,
    messages: Array<{ message: string; type: string }>,
    attachments: any = {},
    flags: string[] = ['no-picture'],
    nickname = 'omni',
    sender = ''
  ) {
    const header = { type: 'chat:system', from: nickname, flags, sender };

    const body = {
      content: messages.map((m) => ({ value: m.message, type: m.type ?? 'text/markdown' })),
      attachments
    };
    const packet = { ...header, body };
    await this.io.send(session, packet);
  }
}

export default MercsServer;
