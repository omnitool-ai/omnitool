/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

/**
 *
 * This file composes the runnable server from services and integrations
 *
 **/

import { OmniLogLevels, registerOmnilogGlobal, type IServiceConfig } from 'omni-shared';
import Server from './core/Server.js';
import { loadServerConfig, type IServerConfig } from './loadConfig.js';
import { exec } from 'child_process';
import os from 'os';
import fs from 'node:fs';

// Services
import { APIServerService, type IAPIServerServiceConfig } from './services/APIService.js';
import { AmqpService } from './services/AmqpService.js';
import { ChatService } from './services/ChatService.js';
import { CredentialService } from './services/CredentialsService/CredentialService.js';
import { LocalFileCredentialStore } from './services/CredentialsService/Store/BaseCredentialStore.js';
import { VaultWardenCredentialStore } from './services/CredentialsService/Store/VaultWardenCredentialStore.js';
import { DBService } from './services/DBService.js';
import { FastifyServerService, type FastifyServerServiceConfig } from './services/FastifyServerService.js';
import { HttpClientService } from './services/HttpClientService.js';
import {
  JobControllerService,
  type IJobControllerServiceConfig
} from './services/JobController/JobControllerService.js';
import { MessagingServerService, type IMessagingServerServiceConfig } from './services/MessagingService.js';
import {
  RESTConsumerService,
  type RESTConsumerServiceConfig
} from './services/RestConsumerService/RESTConsumerService.js';

// Integrations
import { AuthIntegration, type IAuthIntegrationConfig } from './integrations/Authentication/AuthIntegration.js';
import {
  LocalCdnIntegration,
  type ILocalCdnIntegrationConfig
} from './integrations/CdnIntegrations/LocalCdnIntegration.js';
import { ChatIntegration, type IChatIntegrationConfig } from './integrations/Chat/ChatIntegration.js';
import {
  MercsDefaultIntegration,
  type MercsDefaultIntegrationConfig
} from './integrations/Mercenaries/MercsDefaultIntegration.js';
import {
  WorkflowIntegration,
  type IWorkflowIntegrationConfig
} from './integrations/WorkflowIntegration/WorkflowIntegration.js';

import { Command, type OptionValues } from 'commander';
import path from 'path';
import { ServerExtensionManager } from './core/ServerExtensionsManager.js';

// ----------------------------------------- Globals ----------------------------------------
registerOmnilogGlobal();
omnilog.wrapConsoleLogger();
// ----------------------------------------- Server -----------------------------------------
const config: IServerConfig = loadServerConfig('../../.mercs.yaml') as IServerConfig;
const packagejson = JSON.parse(
  fs.readFileSync('package.json', { encoding: 'utf-8' }));

const serverConfig = config.server;
serverConfig.version = packagejson.version;
const server_config = serverConfig;

process.on('unhandledRejection', (reason, promise) => {
  omnilog.trace();
  omnilog.error('Uncaught error in', promise, reason);
  process.exit(1);
});

// ----------------------------------------- CLI -----------------------------------------
const bootstrap = async (): Promise<void> => {
  const program: Command = new Command();
  // common options
  program
    .option('-u, --updateExtensions', 'Update all extensions')
    .option('-rb, --refreshBlocks', 'Refresh block definitions')
    .option('-px, --pruneExtensions', 'Prune deprecated extensions')

    .option('-R, --resetDB <scope>', 'Reset the database on startup. Valid scopes: blocks,settings')
    .option('--chown <user>', 'Reparent all unowned files in CDN storage to this user')
    .option('-ll, --loglevel <level>', 'Set logging level', serverConfig.logger.level.toString())
    .option('--emittery', 'Enable emittery debug logs. Always disabled on log level silent(0).')
    .option('--verbose', 'Max logging level')
    .option(
      '-purl, --publicUrl <url>',
      'Set the external address for services that requires it',
      server_config.network.public_url
    )
    .option(
      '--fastifyopt <fastifyopt>',
      'Advanced Fastify options - JSON Object',
      JSON.stringify({ bodyLimit: 32 * 1024 * 1024 })
    )
    .option('-p, --port <port>', 'Overwrite the listening port', '1688')
    .option('--openBrowser')
    .option('-nx, --noExtensions', 'Disable all (non core) extensions')
    .option('-s, --secure <secure>', 'Enforce secure connection', false)
    .option('--dburl <url>', 'Connection URL to the DB')
    .option('--dbuser <user>', 'DB admin user', 'admin@local.host')
    .option('--viteProxy <url>', 'Specify vite debugger URL')
    .option('--autologin', 'Autologin user')
    .option('--uncensored', 'Disable NSFW protections')
    .option('--flushLogs', 'Flush logs to DB')
    .requiredOption('-l, --listen <addr>', 'Sets the interface the host listens on');

  program.action((options) => {
    // apply option overwrites
    omnilog.setCustomLevel('emittery', options.emittery ? OmniLogLevels.verbose : OmniLogLevels.silent);
    omnilog.level = options.verbose ? OmniLogLevels.verbose : Number.parseInt(options.loglevel);
    const isLocalStack = options.listen === '127.0.0.1';
    // set defaults for Autologin if not present
    if (options.autologin === undefined) {
      options.autologin = isLocalStack;
    }
    // Default to true: set --flushLogs false to disable
    if (options.flushLogs === undefined) {
      options.flushLogs = true;
    }
    // set defaults for DB if not present, rewrites
    if (!options.dburl) {
      server_config.services.db.pocketbaseDbUrl = isLocalStack
        ? serverConfig.services.db.pocketbase.local.dbUrl
        : serverConfig.services.db.pocketbase.development.dbUrl;
    } else {
      server_config.services.db.pocketbaseDbUrl = options.dburl;
    }
    server_config.services.db.pocketbaseDbAdmin = options.dbuser;
    server_config.services.db.flushLogs = options.flushLogs;
    // public URL
    const publicURL = new URL(options.publicUrl);
    server_config.network.public_url = options.publicUrl;
    // Cookie security
    server_config.session.cookie.secure = options.secure;
    // CDN overwrites
    const currentCDNLocalRoute = new URL(server_config.integrations.cdn.localRoute);
    server_config.integrations.cdn.local.url = publicURL.host;
    currentCDNLocalRoute.protocol = publicURL.protocol;
    currentCDNLocalRoute.hostname = publicURL.hostname;
    currentCDNLocalRoute.port = publicURL.port;
    server_config.integrations.cdn.localRoute = currentCDNLocalRoute.href;
    // finally boot
    void boot(options);
  });

  program.parse();
};

// ----------------------------------------- Boot -----------------------------------------
const boot = async (options: OptionValues) => {
  const server = new Server('mercs', serverConfig, options);
  // Initialize global settings before everything starts
  await server.initGlobalSettings();

  const extensionPath = path.join(process.cwd(), 'extensions');

  omnilog.status_start('--- Ensuring core extensions -----');
  await ServerExtensionManager.ensureCoreExtensions(extensionPath);
  omnilog.status_success('OK');

  omnilog.status_start('--- Updating extensions -----');
  await ServerExtensionManager.updateExtensions(extensionPath, options);
  omnilog.status_success('OK');

  if (options.pruneExtensions) {
    omnilog.status_start('--- Pruning extensions -----');
    await ServerExtensionManager.pruneExtensions(extensionPath);
    omnilog.status_success('OK');
  }

  omnilog.status_start('Booting Server');

  // ----------------------------------------- Services -----------------------------------------
  const dbConfig = Object.assign({ id: 'db' }, server_config.services?.db);
  server.use(DBService, dbConfig, 'service');

  const messagingConfig: IMessagingServerServiceConfig = Object.assign(
    { id: 'messaging' },
    serverConfig.services?.messaging
  );
  server.use(MessagingServerService, messagingConfig, 'service');

  // Amqp Service
  const amqpConfig = Object.assign({ id: 'amqp' }, serverConfig.services?.amqp);
  server.use(AmqpService, amqpConfig);

  if (!serverConfig.services?.credentials?.disabled) {
    if (serverConfig.services?.credentials?.type === 'local') {
      const store = new LocalFileCredentialStore(serverConfig.services?.credentials?.storeConfig);
      server.use(
        CredentialService,
        Object.assign({ id: 'credentials' }, serverConfig.services?.credentials, { store })
      );
    } else if (serverConfig.services?.credentials?.type === 'vaultWarden') {
      const store = new VaultWardenCredentialStore(serverConfig.services?.credentials?.storeConfig);
      server.use(
        CredentialService,
        Object.assign({ id: 'credentials' }, serverConfig.services?.credentials, { store })
      );
    } else {
      server.debug('⚠️Default to KV storage');
      server.use(CredentialService, Object.assign({ id: 'credentials' }, serverConfig.services?.credentials));
    }
  } else {
    server.warn('⚠️CredentialService is disabled in config.');
  }
  // RestConsumerService

  if (!serverConfig.services?.rest_consumer?.disabled) {
    const consumerConfig: RESTConsumerServiceConfig = Object.assign(
      { id: 'rest_consumer' },
      serverConfig.services?.rest_consumer
    );
    server.use(RESTConsumerService, consumerConfig);
  } else {
    server.warn('⚠️RestConsumerService is disabled in config.');
  }

  // Axios wrapper
  server.use(HttpClientService, { id: 'http_client' });

  // TODO: Currently this is using the client path rather than directly invoking the functions on the server. That all
  //       needs to be reworked. But for now this allows us to run code on both client and server.
  const apiConfig: IAPIServerServiceConfig = {
    id: 'api',
    host: 'http://127.0.0.1:1688', // remote API is disabled?
    integrationsUrl: '/api/v1/mercenaries/integrations'
  };
  server.use(APIServerService, apiConfig);

  // if (config.server.integrations.cdn.type == 'local') {

  const cdnConfig: ILocalCdnIntegrationConfig = Object.assign({ id: 'cdn' }, serverConfig.integrations?.cdn);
  server.use(LocalCdnIntegration, cdnConfig, 'integration');

  // JobControllerService
  const jobControllerServiceConfig: IJobControllerServiceConfig = Object.assign(
    { id: 'jobs' },
    serverConfig.services?.jobs
  );
  server.use(JobControllerService, jobControllerServiceConfig);

  // Chat Service
  const chatServiceConfig: IServiceConfig = Object.assign({ id: 'chat' });
  server.use(ChatService, chatServiceConfig);

  const listenOn = new URL('http://0.0.0.0:1688');
  listenOn.hostname = options.listen;
  listenOn.protocol = options.secure ? 'https' : 'http';
  listenOn.port = options.port;

  const fastifyOptions = JSON.parse(options.fastifyopt);

  const corsOrigin = [listenOn.origin];
  if (options.viteProxy !== undefined) {
    corsOrigin.push(options.viteProxy);
  }

  const fastifyConfig: FastifyServerServiceConfig = {
    id: 'httpd',
    listen: { host: listenOn.hostname, port: Number.parseInt(listenOn.port) },
    cors: { origin: corsOrigin, credentials: true },
    autologin: options.autologin,
    proxy: {
      enabled: options.viteProxy !== undefined,
      viteDebugger: options.viteProxy
    },
    plugins: {},
    opts: fastifyOptions,
    session: {
      secret: serverConfig.session.secret,
      cookie: serverConfig.session.cookie,
      kvStorage: serverConfig.kvStorage
    },
    rateLimit: {
      global: serverConfig.network.rateLimit.global,
      max: serverConfig.network.rateLimit.max,
      timeWindow: serverConfig.network.rateLimit.timeWindow
    }
  };
  server.use(FastifyServerService, fastifyConfig);

  // ----------------------------------------- Integrations -----------------------------------------
  const mercsIntegrationConfig: MercsDefaultIntegrationConfig = Object.assign(
    { id: 'mercenaries' },
    serverConfig.integrations?.mercenaries
  );
  server.use(MercsDefaultIntegration, mercsIntegrationConfig);

  const workflowConfig: IWorkflowIntegrationConfig = Object.assign(
    { id: 'workflow' },
    serverConfig.integrations?.workflow
  );
  server.use(WorkflowIntegration, workflowConfig);

  const authConfig: IAuthIntegrationConfig = Object.assign({ id: 'auth' }, serverConfig.integrations?.auth);
  server.use(AuthIntegration, authConfig);

  const chatConfig: IChatIntegrationConfig = Object.assign({ id: 'chat' }, serverConfig.integrations?.chat);
  server.use(ChatIntegration, chatConfig);
  // ----------------------------------------- Extensions -----------------------------------------

  await server.init();

  await server.load();
  await server.start();

  omnilog.status_success(`Server has started and is ready to accept connections on ${listenOn.origin}`);
  omnilog.status_success('Ctrl-C to quit.');

  // open default browser
  if (options.openBrowser) {
    switch (os.platform()) {
      case 'win32':
        exec(`start ${options.publicUrl}`);
        break;
      case 'darwin':
        exec(`open ${options.publicUrl}`);
        break;
    }
  }
};

bootstrap().catch((err) => {
  omnilog.trace();
  omnilog.error('Caught unhandled exception during bootstrap: ', err);
  process.exit(1);
});
