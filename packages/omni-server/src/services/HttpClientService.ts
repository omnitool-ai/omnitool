/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import axios, { type AxiosInstance } from 'axios';
import { type IServiceConfig, Service, type ServiceManager } from 'omni-shared';
import type MercsServer from '../core/Server.js';

// HTTP client service wraps up axios and logs requests

interface HTTPClientErrorCode {
  retryable: boolean;
  message: string;
}

const HTTP_CODES: Record<number, HTTPClientErrorCode> = {
  400: {
    message: '[400] The server is having trouble processing your request due to invalid input. Please review your information and submit it again.',
    retryable: false
  },
  401: {
    message: '[401] Authentication failed. Please check your credentials.',
    retryable: false
  },
  403: {
    message: '[403] You are not authorized to perform this action.',
    retryable: false
  },
  404: {
    message: '[404] The requested resource was not found.',
    retryable: false
  },
  408: {
    message: '[408] The server timed out waiting for the request.',
    retryable: true
  },
  409: {
    message: '[409] The server is having trouble processing your request due to a conflict. Please review your information and submit it again.',
    retryable: false
  },
  410: {
    message: '[410] The requested resource is no longer available.',
    retryable: false
  },
  422: {
    message: '[422] The server is having trouble processing your request due to invalid input. Please review your information and submit it again.',
    retryable: false
  },
  429: {
    message: '[429] The server is having trouble processing your request due to too many requests. Please try again later.',
    retryable: true
  },
  500: {
    message: '[500] The server encountered an internal error. Please try again later.',
    retryable: true
  },
  501: {
    message: '[501] The server does not support the requested feature.',
    retryable: false
  },
  502: {
    message: '[502] The server encountered an internal error. Please try again later.',
    retryable: true
  },
  503: {
    message: '[503] The server is currently unavailable. Please try again later.',
    retryable: true
  },
  504: {
    message: '[504] The server timed out waiting for the request.',
    retryable: true
  }
}

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
      if (err.code === 'ENOTFOUND' && err.syscall === 'getaddrinfo') {
        err.message = `Failed to resolve host "${err.hostname}". Please check your network settings.`
      }

      const errorCode = err.response ? err.response.status : err.code
      const error = HTTP_CODES[errorCode]
      if (error) {
        err.message = error.message
        throw new HTTPClientError(error.message, error.retryable, err)
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
