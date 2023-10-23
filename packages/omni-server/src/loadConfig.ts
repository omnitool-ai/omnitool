/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// loadConfig.ts
//  Purpose: Loads the server configuration from the default and local files
// ---------------------------------------------------------------------------------------------
import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';

import { type IAmqpServiceConfig } from './services/AmqpService.js';
import { type ICredentialServiceConfig } from './services/CredentialsService/CredentialService.js';
import { type FastifyServerServiceConfig } from './services/FastifyServerService.js';
import { type IJobControllerServiceConfig } from './services/JobController/JobControllerService.js';
import { type IMessagingServerServiceConfig } from './services/MessagingService.js';
import { type IDBServerServiceConfig } from './services/DBService.js';

interface IServerConfig {
  server: {
    kvStorage?: {
      dbPath: string;
    };

    integrations?: any;
    network: {
      interface: string;
      host: string;
      port: number;
      protocol: string;
      public_url: string;
      rateLimit: {
        global: boolean;
        max: number;
        timeWindow: number;
      };
    };

    session: {
      secret: string;
      cookie: {
        secure: boolean;
        httpOnly: boolean;
        maxAge: number;
      };
    };
    logger: { level: number };
    services: {
      langchain?: {
        opts?: any;
      };
      messaging: IMessagingServerServiceConfig;
      credentials: ICredentialServiceConfig;
      jobs: IJobControllerServiceConfig;
      // registry: IRegistryServiceConfig
      // componentService: IComponentServiceConfig
      amqp?: IAmqpServiceConfig;
      httpd?: FastifyServerServiceConfig;
      db: IDBServerServiceConfig;
      influx?: {
        influxUrl: string;
        influxToken: string;
        influxOrg: string;
      };
      rest_consumer?: {
        endpoint: string;
        username: string;
        password: string;
        exchange: {
          name: string;
          type: string;
          options: { durable: boolean; autoDelete?: boolean; internal?: boolean; arguments?: any };
        };
        retry: {
          disabled: boolean;
          delay: number;
          maxRetries: number;
        };
        useKeystore: boolean;
        disabled: boolean;
      };
    };
  };

  credentials?: {
    seaweed?: {
      headers: any;
    };
  };
}

const loadServerConfig = (defaultFile: string) => {
  let defaultConfig: any = {};

  if (existsSync(defaultFile)) {
    defaultConfig = yaml.load(readFileSync(defaultFile, 'utf8')) as IServerConfig;
    omnilog.info('Importing ', defaultFile, ' configuration');
    return defaultConfig;
  } else {
    // TODO: We need to generate a config for building the production version
    throw new Error('No ' + defaultFile + ' found at repository root');
  }
};

export { loadServerConfig, type IServerConfig };
