/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import axios, { type AxiosInstance } from 'axios';
import { type IServiceConfig, Service, type ServiceManager } from 'omni-shared';
import type MercsServer from '../core/Server.js';

// HTTP client service wraps up axios and logs requests

const RETRYABLE_CODE = [408, 429, 500, 502, 503, 504]

interface HttpClientServiceConfig extends IServiceConfig {}

class HTTPClientError extends Error {
  retryable: boolean
  originalError: any

  constructor(message: string, retryable: boolean, originalError: any) {
    super(message)
    this.retryable = retryable
    this.originalError = originalError
  }
}

class HttpClientService extends Service {
  axios: AxiosInstance;

  constructor(id: string, manager: ServiceManager, config: HttpClientServiceConfig) {
    super(id, manager, config || {});
    this.axios = axios.create();
  }

  async request(config: any, userId?: string) {
    // Check if we need to validate the URL
    if ((this.app as MercsServer).urlValidator) {
      if (!(this.app as MercsServer).urlValidator.validate(config.url)) {
        if (userId)  {
          await ((this.app) as MercsServer).sendToastToUser(userId, { message: `URL ${config.url} is blocked. Please check your server configuration`, options: {type: 'error'} })
        }
        throw new Error(`URL ${config.url} is blocked. Please check your server configuration`)
      }
    }

    try {
      const response = await this.axios.request(config)
      // Check if we need to validate the content type
      if ((this.app as MercsServer).urlValidator) {
        if (!(this.app as MercsServer).urlValidator.validateContentType(response.headers['content-type'])) {
          throw new Error(`Content-Type ${response.headers['content-type']} is not allowed`)
        }
      }
      return response
    } catch (err: any) {
      if (err.response && RETRYABLE_CODE.includes(err.response.status)) {
        throw new HTTPClientError(err.message, true, err)
      } else {
        throw new HTTPClientError(err.message, false, err)
      }
    }
  }

  sanitizeHeader(header: any) {
    // Copy header, so we don't replace the original used for sending the request
    const newHeader = JSON.parse(JSON.stringify(header));

    // Replace authorization header with a placeholder
    if (newHeader.Authorization) {
      newHeader.Authorization = '<REDACTED>';
    }

    return newHeader;
  }

  async load() {
    return true;
  }
}

export { HttpClientService, type HttpClientServiceConfig, HTTPClientError }
