/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import {
  Integration,
  NodeProcessEnv,
  type IAPISignature,
  type IIntegrationsConfig,
  type IntegrationsManager
} from 'omni-shared';
import { type ServerIntegrationsManager } from '../core/ServerIntegrationsManager';
import { type FastifyServerService } from '../services/FastifyServerService';

// TODO: [security] - Make sure to never pass error objects back to the client as they may leak credentials

// Template API integration plugin.
// usage:
//  - create a new class extending APIIntegration
//  - register the integration in the IntegrationsManager
//  - add desired routes and proxy entries to mercs configuration

interface IAPIIntegrationConfig extends IIntegrationsConfig {
  endpoints: string[];
  routes?: IAPISignature[];
}

class APIIntegration extends Integration {
  handlers: Map<string, Function>;
  clientExports: Map<string, Function>;
  serverHandlers: Map<string, Function>;
  routes: Set<IAPISignature>;
  schemas: Map<string, any>;

  constructor(id: string, manager: IntegrationsManager, config: IAPIIntegrationConfig) {
    super(id, manager, config || {});

    this.routes = new Set();

    this.handlers = new Map(); // TODO: <-- [georg] this needs to go away in favor of server handlers
    this.clientExports = new Map();
    this.serverHandlers = new Map();
    this.schemas = new Map();
  }

  declareClientExport(clientExport: any) {
    const manager = this.manager as ServerIntegrationsManager;
    if (!manager.clientExports.has(clientExport)) {
      manager.clientExports.add(clientExport);
    }
  }

  getEndpoint(route?: string): string {
    let ret = (this.config as IAPIIntegrationConfig).endpoints[0];
    if (route) {
      ret += route;
    }
    return ret;
  }

  addRoute(route: IAPISignature) {
    this.routes.add(route);
  }

  replaceTokens(string: string, field: string): any {
    const ret = string.replace(/\$\{([^}]+)\}/g, (match: any, p1: any) => {
      if (!Object.keys(this.config).includes(p1)) {
        // if the config value is not found, check if it's a function
        // @ts-ignore
        if (this[p1] != null && typeof this[p1] === 'function') {
          // @ts-ignore
          return this[p1]();
        } else {
          this.warn('replaceTokens: Unable to resolve variable', p1, 'in field ', field);
          return undefined;
        }
      } else {
        // @ts-ignore
        return this.config[p1];
      }
    });
    this.verbose('replaceTokens', field, ret);
    return ret;
  }

  async load() {
    const config = JSON.parse(JSON.stringify(this.config as IAPIIntegrationConfig));
    if (!this.app.services.has('httpd')) {
      this.warn('API service not found, cannot register routes');
      return false;
    }

    this.debug(`${this.id} integration loading...`);
    // Auto register any routes found in the config
    for (const path in config.routes || []) {
      // @ts-ignore
      const def = config.routes[path];
      if (def == null) {
        this.warn('Empty route definition: null', path);
        continue;
      }
      let method = 'GET';
      let endpoint = path;
      // routes can be denoted as 'GET /path' or just '/path'
      if (path.includes(' ')) {
        [method, endpoint] = path.split(' ');
      }

      // clone the object to avoid overwriting the original configuration
      const route = JSON.parse(JSON.stringify(def));
      route.method = method;

      if (this.handlers.has(route.handler)) {
        const apiDef: any = this.handlers.get(route.handler);
        // @ts-ignores
        const { handler, schema } = apiDef(this, def.opts);
        route.handler = handler;
        route.schema = schema;

        // If the route has a client export, we need to declare it as such
        if (this.clientExports.has(route.clientExport)) {
          // @ts-ignore
          const clientExport = this.clientExports.get(route.clientExport)();
          clientExport.namespace = this.id;
          clientExport.name = route.clientExport;
          clientExport.method = route.method;
          clientExport.endpoint = endpoint;
          this.declareClientExport(clientExport);
        }
      } else {
        this.error(
          endpoint,
          'route handler function not found, have you added it to the integrations handler Map?',
          route.handler
        );
        continue;
      }

      this.debug(`${this.id}: addRoute`, route.method, endpoint, 'handler installed');

      if (route.insecure && process.env.NODE_ENV === NodeProcessEnv.production) {
        this.warn(`${this.id}: route`, route.method, endpoint, 'is not secured by token.');
      }

      this.addRoute({ url: endpoint, ...route });
    }

    const api: FastifyServerService = this.app.services.get('httpd') as FastifyServerService;

    this.routes.forEach((route: IAPISignature) => {
      api.registerAPI(route);
    });

    this.success(`${this.id} integration loaded.`);
    return true;
  }
}

export { APIIntegration, type IAPIIntegrationConfig };
