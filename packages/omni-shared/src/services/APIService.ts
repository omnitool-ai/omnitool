/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

/* eslint-disable @typescript-eslint/ban-types */
// -------------------------------------------------------------
//
// -------------------------------------------------------------

import { type IManager } from '../core/Manager.js';
import { Service, type IServiceConfig } from '../core/Service.js';

import axios from 'axios';

interface IAPIServiceConfig extends IServiceConfig {
  host: string;
  integrationsUrl: string;
}

interface IAPIDefinition {
  key: string;
  handler: Function;
  params: any[];
  description?: string;
}

interface IRemoteAPI {
  name: string;
  description: string;
  method: string;
  params: Array<{
    convert?: string;
    name: string;
    type: string;
    required?: boolean;
    default?: any;
    min?: number;
    max?: number;
  }>;
  endpoint: string;
  namespace: string;
  results?: {};
  cache?: any; // TODO: [route caching]
}

class APIService extends Service {
  constructor(id: string, manager: IManager, config: IAPIServiceConfig) {
    super(id, manager, config || { id });
  }

  create() {
    this.info(`${this.id} create`);
    // Create a shortcut accessor on the client object
    Object.defineProperty(this.app, 'api', { value: this, writable: false, enumerable: false });
    return true;
  }

  _clampValues(remoteAPI: IRemoteAPI, args: any): void {
    // Clamp values to min/max
    const service = this;
    for (const key in args) {
      // @ts-ignore
      const rp = remoteAPI.params[key];
      if (rp != null && rp.type === 'number') {
        if (rp.min != null && args[key] < rp.min) {
          service.warn(
            `Invalid parameter value for ${key} for ${remoteAPI.namespace}.${remoteAPI.name}, clamping to min value ${rp.min}`,
            args
          );
          args[key] = rp.min;
        }
        if (rp.max != null && args[key] > rp.max) {
          service.warn(
            `Invalid parameter value for ${key} for ${remoteAPI.namespace}.${remoteAPI.name}, clamping to max value ${rp.max}`
          );
          args[key] = rp.max;
        }
      }
    }
  }

  _validateArgs(remoteAPI: IRemoteAPI, args: any): void {
    const service = this;
    for (const param of remoteAPI.params) {
      // Enforce required:true parameters to exist
      if (param.required === true && args[param.name] == null) {
        service.error(`Missing parameter ${param.name} for ${remoteAPI.namespace}.${remoteAPI.name}`, args);
        throw new Error(`Missing parameter ${param.name} for ${remoteAPI.namespace}.${remoteAPI.name}`);
      } else if (args[param.name] == null && param.default != null) {
        // Augment default values
        args[param.name] = param.default;
      }

      let isArray = false;
      // Perform Type Validation
      if (args[param.name] != null && param.type != null) {
        isArray = param.type.includes('[]');
        let type = param.type;
        const value = args[param.name];
        // Validate that arrayts are arrays
        if (isArray) {
          type = type.replace('[]', '');
          if (!Array.isArray(value)) {
            const err = `Invalid parameter type ${typeof value} for ${param.name} for ${remoteAPI.namespace}.${
              remoteAPI.name
            }. Expected an Array`;
            service.error(err);
            throw new Error(err);
          }
        }

        if (type !== '') {
          // TODO: handle arrays

          if (isArray) {
            // eslint-disable-next-line valid-typeof
            if (!value.every((v: any) => (type === 'image' && v.ticket) || typeof v === type)) {
              const err = `Invalid parameter value type ${typeof value[0]} for ${param.name} for ${
                remoteAPI.namespace
              }.${remoteAPI.name}. Expected an Array of ${type}`;
              service.error(err);
              throw new Error(err);
            }
            // eslint-disable-next-line valid-typeof
          } else if ((type === 'image' && !value.ticket) || typeof value !== type) {
            const err = `Invalid parameter type ${typeof value} for ${param.name} for ${remoteAPI.namespace}.${
              remoteAPI.name
            }. Expected ${type}`;
            service.error(err);
            throw new Error(err);
          }
        }
      }
    }
  }

  // Function to convert artifacts to the right representation required for this service
  async _convertValues(remoteAPI: IRemoteAPI, args: any): Promise<void> {}

  wrappedAxiosCall(remoteAPI: IRemoteAPI): any {
    const service = this;

    return async function (args: any, opts?: { headers?: any }, responseOpts?: { raw?: boolean }): Promise<any> {
      // @ts-ignore
      for (const key in args) {
        if (args[key] == null) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete args[key];
        }
      }

      service.verbose(`Validating ${remoteAPI.namespace}.${remoteAPI.name}`);

      service._validateArgs(remoteAPI, args); // Basic validation for datatypes
      service._clampValues(remoteAPI, args); //
      await service._convertValues(remoteAPI, args);

      const serviceConfig = service.config as IAPIServiceConfig;
      let axiosConfig: any = {
        // @ts-ignore
        method: remoteAPI.method.toLowerCase(),
        // @ts-ignore
        url: serviceConfig.host + remoteAPI.endpoint,
        withCredentials: true,
        data: args
      };

      if (axiosConfig.method === 'get') {
        axiosConfig.params = args;
        // axiosConfig.params.cacheBust = Date.now()
      }

      if (opts != null && typeof opts === 'object') {
        axiosConfig = { ...axiosConfig, ...opts };
      }

      service.info(`Invoking ${remoteAPI.namespace}.${remoteAPI.name}`);

      try {
        const result = await axios(axiosConfig);
        service.verbose('Remote function result received');
        if (responseOpts?.raw) {
          return result;
        } else {
          // If a results object is defined, then we need to map the results to the return object as instructed
          if (
            remoteAPI.results != null &&
            typeof remoteAPI.results === 'object' &&
            Object.keys(remoteAPI.results).length > 0
          ) {
            const ret = {};
            for (const key in remoteAPI.results) {
              // @ts-ignore
              ret[key] = result.data[remoteAPI.results[key].prop];
            }
            return ret;
          } else {
            return result.data;
          }
        }
      } catch (ex: any) {
        // @ts-ignore
        service.error(
          `Error invoking ${remoteAPI.namespace}.${remoteAPI.name}`,
          axiosConfig,
          ex?.response?.data?.error,
          ex
        );
        return { error: ex?.response?.data?.error || ex?.message || ex };
      }
    };
  }

  async getRemoteAPIsfromServer() {
    const serviceConfig = this.config as IAPIServiceConfig;
    try {
      this.verbose('Registering remote functions from', serviceConfig.host, serviceConfig.integrationsUrl);
      const result = await axios.get(serviceConfig.host + serviceConfig.integrationsUrl);
      this.success('Received remoteAPIs from server');
      // this.verbose('APIS:', result.data)
      return result.data;
    } catch (ex) {
      this.error('Failed to load remoteAPIs from server', ex);
      return [];
    }
  }

  async start() {
    this.info(`${this.id} start`);
    return true;
  }

  async stop() {
    this.info(`${this.id} stop`);

    return true;
  }
}

export { APIService, type IAPIDefinition, type IAPIServiceConfig, type IRemoteAPI };
