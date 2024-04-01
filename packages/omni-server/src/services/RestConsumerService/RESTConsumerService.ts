/* eslint-disable @typescript-eslint/no-dynamic-delete */
/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

/**
 * REST consumer service that listens for messages on an AMQP queue and executes an Axios call with the received payload.
 * The service is implemented as a subclass of the `Service` class  provided by the `omni-shared` module, and it uses
 * the `amqplib` and `axios` modules for communicating with the AMQP server and making HTTP requests, respectively.
 *
 * The configuration object for the service should specify the endpoint URL and authentication credentials for the AMQP server,
 * as well as the exchange and routing key to use for receiving messages.
 *
 * In the standalone installation, the rest consumer is powered by a SQLite based queue implementation mocking amqlib.
 *
 * For enterprise deployments, we offer an implementation using RabbitMQ for the queue which scales horizontally.
 * By running it in a separate process, security is enhanced since the primary process doesn't have access to credentials.
 *
 **/

import { Service, omnilog, type IServiceConfig, type ServiceManager } from 'omni-shared';

import os, { type } from 'os';
import * as Amqp from './MockMQ.js';

import FormData from 'form-data';

import { v4 as uuidv4 } from 'uuid'
import type MercsServer from '../../core/Server.js'
import { type CredentialService } from '../CredentialsService/CredentialService.js'
import { HTTPClientError, type HttpClientService } from '../HttpClientService.js'
import { type OmniAPIAuthenticationScheme } from 'omni-sockets/src/components/openapi/types'
import { capitalize } from 'lodash-es'
import Replicate from 'replicate'
import { processHuggingface } from "./HuggingFace.js"
import { t } from 'tar';


const TASK_PROTOCOL_VERSION = 'aardvark' // Protocol version, needs to match the version used by the AMQP service

// Define the configuration interface for the REST consumer service
interface RESTConsumerServiceConfig extends IServiceConfig {
  endpoint: string; // The endpoint URL for the AMQP server
  username: string; // The username for authenticating with the endpoint
  password: string; // The password for authenticating with the endpoint
  fixedQueue?: string;
  exchange: { name: string; type: string; options: any }; // The AMQP exchange configuration
  retry: {
    disabled?: boolean;
    maxRetries: number;
    delay: number;
  }
}

class SignatureTelemetry {
  requestCount: number;
  responseCount: number;
  exceptionCount: number;
  smoothedDuration: number | null;
  latestResponseCode: number | string | null;
  backoffDuration: number;
  durationBuckets: Map<number, { count: number; sum: number; sumSquared: number }>;

  constructor() {
    this.requestCount = 0;
    this.responseCount = 0;
    this.exceptionCount = 0;
    this.smoothedDuration = null;
    this.latestResponseCode = null;
    this.backoffDuration = 0;
    this.durationBuckets = new Map();
  }

  incrementRequestCount() {
    this.requestCount += 1;
  }

  updateOnResponse() {
    this.responseCount += 1;
    this.backoffDuration = 0;
  }

  updateOnException() {
    this.exceptionCount += 1;
    // Increase the backoff duration exponentially, capped at 30000ms (30 seconds)
    this.backoffDuration = Math.min(this.backoffDuration * 1.5 + 20, 30000);
  }

  updateOnHttp429TooManyRequests() {
    // Increase the backoff duration exponentially, capped at 30000ms (30 seconds)
    this.backoffDuration = Math.min(this.backoffDuration * 2 + 200, 30000);
  }

  addToDurationBucket(duration: number): void {
    const bucketIndex = Math.floor(Math.log2(duration));
    const bucket = this.durationBuckets.get(bucketIndex) ?? { count: 0, sum: 0, sumSquared: 0 };

    bucket.count += 1;
    bucket.sum += duration;
    bucket.sumSquared += duration * duration;

    this.durationBuckets.set(bucketIndex, bucket);
  }

  summarize(url: string) {
    return `TelemetrySummary(${url}) : SmoothedDuration:${this.smoothedDuration}, ResponseCount:${this.responseCount}, ExceptionCount:${this.exceptionCount}, LatestResponseCode:${this.latestResponseCode}`;
  }

  // Serialize the instance to a JSON string
  toJSON(): string {
    return JSON.stringify(this);
  }
}

// Define the REST consumer service class
class RESTConsumerService extends Service {
  connection?: Amqp.Connection;
  channel?: Amqp.Channel;
  integrations: Map<string, { method: string; url: string; contentType: string; security?: any }>;

  config: RESTConsumerServiceConfig;

  constructor(id: string, manager: ServiceManager, config: RESTConsumerServiceConfig) {
    // Call the parent constructor with the updated configuration object
    super(id, manager, config || {});

    this.config = config;
    this.integrations = new Map();
  }

  get server(): MercsServer {
    return this.manager.app as MercsServer;
  }

  // -------------------------------------------------------------------------------------
  // Define a helper function to generate the endpoint URL from the information in the config
  endpointURL() {
    let username = this.config.username;
    let password = this.config.password;

    if (username && password) {
      // TODO: encrypt username+password when not in use
      username = typeof username === 'function' ? (username as () => string)() : username;
      password = typeof password === 'function' ? (password as () => string)() : password;

      // Replace the username+password placeholders in the endpoint URL with actual values
      return this.config.endpoint.replace('{{username}}', username).replace('{{password}}', password);
    }

    // Local queue does not require username+password
    return '';
  }

  // -------------------------------------------------------------------------------------
  /// Define a helper function to get the API signature for the given API name
  private async getAPISignature(integration: { key: string; operationId: string }): Promise<any> {
    try {
      const blockManager = this.server.blocks;
      const signature = blockManager.getAPISignature(integration.key, integration.operationId);
      this.debug('Signature ', JSON.stringify(signature, null, 2));
      return signature;
    } catch (error:any) {
      throw new Error(`Invalid API signature for message API ${integration.key}.${integration.operationId}`, error.message);
    }
  }

  // Store request cookies with corresponding data
  private readonly requestMap = new Map<string, any>();
  // Store URLs as keys with instances of SignatureTelemetry as values
  private readonly signatureMap = new Map<string, SignatureTelemetry>();

  // -------------------------------------------------------------------------------------
  // Define a helper function that returns a unique UUID v4 string
  private generateUniqueCookie(): string {
    return uuidv4();
  }

  // -------------------------------------------------------------------------------------
  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      await Promise.resolve();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async securityScheme(
    securitySpecs: OmniAPIAuthenticationScheme[],
    userId: string,
    apiNamespace: string,
    baseUrl: string,
    requestConfig: any
  ): Promise<void> {
    const credentialService = this.app.services.get('credentials') as CredentialService;

    for (const security of securitySpecs) {
      if (security.type === 'http_basic') {
        const username = await credentialService.get(userId, apiNamespace, baseUrl, 'username');
        const password = await credentialService.get(userId, apiNamespace, baseUrl, 'password');
        if (!username || !password) {
          if (security.isOptional) {
            this.info(`Missing credentials for namespace '${apiNamespace}'`);
          } else {
            this.error(`Missing credentials for namespace '${apiNamespace}'`);
          }
          // Try another security scheme if any
          continue;
        }

        // Assign authorization header in request config
        requestConfig.headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      } else if (security.type === 'http_bearer') {
        if (security.requireKeys && security.requireKeys.length > 0) {
          const token = await credentialService.get(userId, apiNamespace, baseUrl, security.requireKeys[0].id);
          if (!token) {
            if (security.isOptional) {
              this.info(`Missing credentials for namespace '${apiNamespace}'`);
            } else {
              this.error(`Missing credentials for namespace '${apiNamespace}'`);
            }
            // Try another security scheme if any
            continue;
          }

          // Create HTTP Bearer authentication header
          requestConfig.headers.Authorization = `${capitalize(security.requireKeys[0].id)} ${token}`;
        }
      } else if (security.type === 'apiKey') {
        // Get api key from the vault
        if (security.requireKeys && security.requireKeys.length > 0) {
          const credKey = security.requireKeys[0];
          if (credKey) {
            const apiKey = await credentialService.get(userId, apiNamespace, baseUrl, credKey.id);
            if (!apiKey) {
              if (security.isOptional) {
                this.info(`Missing credentials for namespace '${apiNamespace}'`);
              } else {
                this.error(`Missing credentials for namespace '${apiNamespace}'`);
              }
              // Try another security scheme if any
              continue;
            }

            if (credKey.in === 'header') {
              // Create HTTP Bearer authentication header
              requestConfig.headers[credKey.id] = apiKey;
            } else if (credKey.in === 'query') {
              requestConfig.params[credKey.id] = apiKey;
            } else if (credKey.in === 'cookie') {
              requestConfig.headers.Cookie = requestConfig.headers.Cookie
                ? `${requestConfig.headers.Cookie}; ${credKey.id}=${apiKey}`
                : `${credKey.id}=${apiKey}`;
            } else {
              this.error(`Unsupported security scheme parameter location '${credKey.in}'`);
              // Try another security scheme if any
              continue;
            }
          }
        } else {
          if (security.isOptional) {
            this.info('Missing security scheme parameter name');
          } else {
            this.error('Missing security scheme parameter name');
          }
          // Try another security scheme if any
          continue;
        }
      } else if (security.type === 'oauth2') {
        if (security.oauth?.authorizationCode) {
          try {
            const token = await credentialService.getOAuth2AccessToken(userId, apiNamespace, baseUrl);
            // Create HTTP Bearer authentication header
            requestConfig.headers.Authorization = token;
          } catch (err) {
            if (security.isOptional) {
              this.info(`Access token failure for namespace '${apiNamespace}'`, err);
            } else {
              this.error(`Access token failure for namespace '${apiNamespace}'`, err);
            }
            // Try another security scheme if any
            continue;
          }
        } else {
          if (security.isOptional) {
            this.info(`Unsupported oauth flow type '${security.oauth}'`);
          } else {
            this.error(`Unsupported oauth flow type '${security.oauth}'`);
          }
          // Try another security scheme if any
          continue;
        }
      } else {
        if (security.isOptional) {
          this.info(`Unsupported security scheme type '${security.type}'`);
        } else {
          this.error(`Unsupported security scheme type '${security.type}'`);
        }
        // Try another security scheme if any
        continue;
      }
    }
  }

  // -------------------------------------------------------------------------------------
  // Register an Axios request with the provided signature and return a unique request cookie
  async registerAxiosRequest(signature: any): Promise<string> {
    const requestCookie = this.generateUniqueCookie();
    const requestTimestamp = Date.now();
    this.requestMap.set(requestCookie, { requestTimestamp, url: signature.url });

    // Get or create the SignatureMapValue instance associated with signature.url
    let urlEntry = this.signatureMap.get(signature.url);
    if (urlEntry == null) {
      urlEntry = new SignatureTelemetry();
      this.signatureMap.set(signature.url, urlEntry);
    }

    // Increate it's request count by one.
    urlEntry.incrementRequestCount();

    // Sleep if required
    if (urlEntry.backoffDuration > 0) {
      omnilog.log(`Sleeping for ${urlEntry.backoffDuration} ms before making another request`);
      await this.sleep(urlEntry.backoffDuration);
    }

    return requestCookie;
  }

  // -------------------------------------------------------------------------------------
  // Register an Axios response associated with the requestCookie
  private registerAxiosResponse(requestCookie: string, status: string, data: any): void {
    const requestEntry = this.requestMap.get(requestCookie);
    if (!requestEntry) {
      omnilog.error(`Error: Invalid or duplicate response for request ${requestCookie}`);
      return;
    }

    this.requestMap.delete(requestCookie);

    const url = requestEntry.url;
    const telemetry = this.signatureMap.get(url);
    if (telemetry == null) {
      omnilog.error(`Error: Telemetry object not found for URL ${url}`);
      return;
    }

    const responseTimestamp = Date.now();
    const requestTimestamp = requestEntry.requestTimestamp;
    const duration = responseTimestamp - requestTimestamp;

    telemetry.addToDurationBucket(duration);

    telemetry.smoothedDuration = telemetry.smoothedDuration
      ? telemetry.smoothedDuration * 0.5 + duration * 0.5
      : duration;

    if (status === 'exception') {
      telemetry.latestResponseCode = 'exception';
      telemetry.updateOnException();
      return;
    }

    // Get the response code
    const responseCode = data.status;

    // Store the most recent response code on the telemetry object
    telemetry.latestResponseCode = responseCode;
    if (responseCode >= 200 && responseCode < 300) {
      /* "Success" */
      telemetry.updateOnResponse();
    } else if (responseCode === 429) {
      telemetry.updateOnHttp429TooManyRequests();
    } else {
      telemetry.updateOnException(); /* ...TODO... */
    }
  }

  private safeDeepClone<T extends Record<string, any>>(obj: T, cloned = new WeakMap()): T {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (cloned.has(obj)) {
      return cloned.get(obj) as T;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const clone = Array.isArray(obj) ? [] : ({} as T);
    cloned.set(obj, clone);

    for (const key in obj) {
      if (obj.hasOwnProperty?.(key)) {
        // @ts-ignore
        clone[key] = this.safeDeepClone(obj[key], cloned);
      }
    }

    // @ts-ignore
    return clone;
  }

  private sanitizeRequest(requestConfig: any) {
    const newRequestConfig = this.safeDeepClone(requestConfig);

    if (newRequestConfig.headers) {
      delete newRequestConfig.headers;
      // Replace authorization header with a placeholder
      // if (newRequestConfig.headers['Authorization']) {
      //  newRequestConfig.headers['Authorization'] = '<REDACTED>'
      // }
    }
    return newRequestConfig;
  }

  // -------------------------------------------------------------------------------------
  // Define a helper function to execute an axios call with the provided message object
  private async executeAxiosCall(payload: any): Promise<any> {
    // Validate the message payload and type
    if (!payload?.integration) {
      this.error('Invalid message: message or integration missing', payload);
      throw new Error('Invalid message: message or integration missing');
    }

    if (payload.integration.key.startsWith('omni-core-replicate:')) {
      const credentialService = this.app.services.get('credentials') as CredentialService;
      const blockManager = this.server.blocks;
      let baseUrl = blockManager.getNamespace('replicate')?.api?.basePath ?? '';

      // ----------------------------
      // Somewhat hacky way to ensure Replicate URL is correct.
      // We will eventually remove this in a few months
      // ---------------------------- HACK START
      // Ensure the URL does not end with a '/'
      if (baseUrl.endsWith('/')) 
      {
        baseUrl = baseUrl.slice(0, -1);
      }
      // If there's an extra '/v1/v1', correct to a single '/v1'
      if (baseUrl.endsWith('/v1/v1')) 
      {
        // remove the last 3 characters
        baseUrl = baseUrl.slice(0, -3);
      } 
      else if (!baseUrl.endsWith('/v1')) 
      {
        baseUrl += '/v1';
      }
      // ---------------------------- HACK END

      const { owner, model, version } = payload.body._replicate;
      delete payload.body._replicate;
      const replicate = new Replicate({
        auth: await credentialService.get(payload.job_ctx.user, 'replicate', baseUrl, 'token')
      });

      const input = payload.body;
      const output = await replicate.run(`${owner}/${model}:${version}`, { input });
      return { output, _omni_status: 200 };
    }

    if (payload.integration.key.startsWith('huggingface')) {
      const results = await processHuggingface(payload, this);
      if (results) return results;      
    }

    payload.headers ??= {};

    // Get the API signature for the message payload API
    const signature = JSON.parse(JSON.stringify(await this.getAPISignature(payload.integration)));
    // Some signatures are missing the content type
    signature.contentType ??= 'application/json';

    // Validate the signature object
    if (!signature?.url || !signature.method || !signature.contentType) {
      this.error('invalid signature', payload.integration, signature);
      throw new Error(`Unknown API signature for message API '${payload.integration}'`);
    }

    // Build the axios request configuration object using the API signature and message payload
    let urlObject;

    if (payload.params && Array.isArray(payload.params) && payload.params.length > 0) {
      const query: any = {};

      for (const param of payload.params) {
        if (param.in === 'path') {
          signature.url = signature.url.replace(`{${param.name}}`, param.value);
          delete payload.body[param.name];
        } else if (param.in === 'header' && param.value !== '') {
          payload.headers[param.name] ??= param.value; // don't overwrite existing keys
          delete payload.body[param.name];
        } else if (param.in === 'query') {
          query[param.name] = param.value;
          delete payload.body[param.name];
        }
      }

      // After all params are processed, add query params to the URL
      urlObject = new URL(signature.url);
      urlObject.search = new URLSearchParams(query).toString();
      signature.url = urlObject.toString();
    }
    let responseType = 'json';
    if (payload.responseContentType) {
      if (
        payload.responseContentType.startsWith('audio/') ||
        payload.responseContentType.startsWith('application/ogg') ||
        payload.responseContentType.startsWith('video/') ||
        payload.responseContentType.startsWith('image/') ||
        payload.responseContentType.startsWith('application/octet-stream')
      ) {
        responseType = 'arraybuffer';
      } else if (payload.responseContentType.startsWith('text/')) {
        responseType = 'text';
      }
    }

    let data = JSON.parse(JSON.stringify(payload.body));

    if (signature.method.toLowerCase() !== 'get') {
      if (signature.requestContentType === 'multipart/form-data') {
        const blockManager = this.server.blocks;
        const block = blockManager.getBlock(payload.integration.block)
        const formData = new FormData();

        // Iterate over all fields
        for (const key in data)
        {
          // if we have a block definition
          if (block)
          {
            const input = block.inputs[key]
            // Detect binary inputs.
            if (input.format === 'binary')
            {
              // If the input is a CDN object, we need to fetch it and add it to the form data via stream
              if (data[key] && typeof(data[key]) === 'object' && data[key].fid && typeof(data[key].fid) === 'string'  )
              {
                //@ts-ignore
                const cdnRecord = await this.app.cdn.get({fid: data[key].fid}, {}, 'stream');
                if (cdnRecord)
                {
                  const stream = cdnRecord.data;
                  formData.append(key, stream, {
                    filename: cdnRecord.fileName || 'file.bin',
                    contentType: cdnRecord.mimeType
                  });
                  continue;
                }
              }
            }
          }
          if (Array.isArray(data[key])) {
            data[key].forEach((item, index) => {
              Object.keys(item).forEach(propertyKey => {
                // Construct the form data name using the array key, index, and property key
                const name = `${key}[${index}][${propertyKey}]`;
                formData.append(name, item[propertyKey]);
              });
            });
          } else {
            formData.append(key, data[key]);
          }
        }

        data = formData;
      }

    }

    const requestConfig = {
      method: signature.method,
      url: signature.url,
      data: signature.method.toLowerCase() !== 'get' ? data : undefined,
      params: signature.method.toLowerCase() === 'get' ? data : undefined,
      timeout: payload.timeout ?? 1000 * 60 * 4,
      headers: payload.headers || {},
      responseType,
      responseEncoding: payload.responseEncoding || 'utf8'
      // context: payload.job_ctx || undefined,
    };

    requestConfig.headers['Content-Type'] = signature.requestContentType || 'application/json';

    const requestCookie = await this.registerAxiosRequest(signature);

    const httpClient = this.app.services.get('http_client') as HttpClientService;

    // If credentials are required, we apply them to the request here
    if (signature.security && signature.security.length > 0) {
      const context = payload.job_ctx || {};
      await this.securityScheme(signature.security, context.user, payload.integration.key, signature.url, requestConfig);
    }

    try {
      this.info('Executing axios call with configuration:', this.sanitizeRequest(requestConfig));

      const response: any = await httpClient.request(requestConfig);

      if (response?.data && response.data instanceof Buffer) {
        response.data = {
          // @ts-ignore
          result: await this.app.cdn.putTemp(response.data, {
            mimeType: payload.responseContentType,
            userId: payload.job_ctx?.userId,
            jobId: payload.job_ctx?.jobId
          })
        };
      }

      this.verbose('Axios call successful');

      this.registerAxiosResponse(requestCookie, 'response', response);

      if (response.data && typeof response.data === 'string') {
        // Not sure what to do here??
        return { result: response.data};
      }

      // Return the successful response
      return { ...response.data};
    } catch (error: any) {
      let originalError = null
      if (error instanceof HTTPClientError) {
        if (error.retryable) {
          // Retryable error: bubble it up to the consumer
          throw error
        } else {
          originalError = error.originalError
        }
      } else {
        originalError = error
      }

      const sanitizedError = {
        requestConfig: this.sanitizeRequest(requestConfig),
        error: {
          message: originalError.message,
          details: originalError.response?.data?.error || originalError.response?.data,
          code: originalError.code
        }
      };

      this.error('Axios call failed with error:', sanitizedError)
      this.registerAxiosResponse(requestCookie, 'exception', originalError)

      throw new Error(JSON.stringify(sanitizedError));
    }
  }

  // -------------------------------------------------------------------------------------
  // Helper to publish a successful result
  private enqueueResult(taskId: string, shardId: string, results: any): void {
    this.verbose('Axios call successful', taskId);

    const resultMessage = {
      taskId,
      result: results,
      server: {
        hostname: os.hostname(),
        /* platform: os.platform(),
      release: os.release(),
      type: os.type(),
      arch: os.arch(),
      cpus: os.cpus(), */
        protocol: TASK_PROTOCOL_VERSION
      }
    };
    delete results.error;
    this.verbose('Publishing result message', this.config.exchange.name, `RESULTS-${TASK_PROTOCOL_VERSION}.${shardId}`);
    if (this.channel == null) {
      throw new Error('Channel not initialized');
    }
    void this.channel.publish(
      this.config.exchange.name,
      `RESULTS-${TASK_PROTOCOL_VERSION}.${shardId}`,
      Buffer.from(JSON.stringify(resultMessage))
    );
  }

  private enqueueFailure(taskId: string, shardId: string, error: { message: string }): void {
    this.error('Axios call failed with error', error);

    const resultMessage = {
      taskId,
      error,
      server: {
        hostname: os.hostname(),
        /* platform: os.platform(),
      release: os.release(),
      type: os.type(),
      arch: os.arch(),
      cpus: os.cpus(), */
        protocol: TASK_PROTOCOL_VERSION
      }
    };
    void this.channel?.publish(
      this.config.exchange.name,
      `RESULTS-${TASK_PROTOCOL_VERSION}.${shardId}`,
      Buffer.from(JSON.stringify(resultMessage))
    );
  }

  // -------------------------------------------------------------------------------------
  // Override the parent load() method to set up the AMQP connection and message consumer
  async start(): Promise<boolean> {
    const config = this.config;

    // Connect to the AMQP server using the provided endpoint URL
    this.connection = Amqp.connect(this.endpointURL(), this.app.config);
    this.success('Connection to AMQP Task server established');

    // Create a channel for sending and receiving messages
    const channel = (this.channel = await this.connection.createChannel());

    // Declare the exchange with the provided configuration
    await this.channel.assertExchange(config.exchange.name, config.exchange.type, config.exchange.options);

    this.success('Asserted exchange ' + config.exchange.name);

    // Create a queue for the specified routing key
    const queueName = this.id + '-' + TASK_PROTOCOL_VERSION + '-queue' + (config.fixedQueue ?? '')
    const routingKey = `REST-${TASK_PROTOCOL_VERSION}.requests` + (config.fixedQueue ?? '')

    // Create a queue for dead-letter
    const deadLetterQueueName = this.id+ '-' + TASK_PROTOCOL_VERSION + '-dead-letter-queue'
    const deadLetterRoutingKey = 'REST-' + TASK_PROTOCOL_VERSION + '.dead-letter'
    if (this.config.retry && !this.config.retry.disabled) {
      await this.channel.assertQueue(deadLetterQueueName, {
        deadLetterExchange: config.exchange.name,
        deadLetterRoutingKey: routingKey,
        messageTtl: this.config.retry?.delay
      })

      await this.channel.bindQueue(deadLetterQueueName, config.exchange.name, deadLetterRoutingKey)
      this.success('Dead letter queue created and bound to jobs exchange')

      // Declare and bind the queue to the exchange with the specified routing key
      await this.channel.assertQueue(queueName, {
        deadLetterExchange: deadLetterQueueName,
        deadLetterRoutingKey
      })
    } else {
      // Declare and bind the queue to the exchange with the specified routing key
      await this.channel.assertQueue(queueName)
    }

    await this.channel.bindQueue(queueName, config.exchange.name, routingKey)
    this.success('Queue created and bound to jobs exchange, waiting to consume messages')

    // Consume messages from the queue
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    void this.channel.consume(queueName, async (message: Amqp.Message) => {
      this.verbose('Message received', message);
      try {
        // Check if the message is valid
        if (!message?.content?.toString()) {
          throw new Error('Invalid message received');
        }

        // Parse the message payload as a JSON object
        const payload = JSON.parse(message.content.toString());
        if (!payload?.taskId) {
          throw new Error('Missing payload or taskId, discarding:' + JSON.stringify(payload));
        }

        // Log the received payload
        this.verbose(`Received message with payload: ${JSON.stringify(payload)}`);

        let result;
        // Execute the axios call asynchronously with the received payload
        try {
          result = await this.executeAxiosCall(payload);
          this.enqueueResult(payload.taskId, payload.shardId, result);
        } catch (error: unknown) {
          let e: { message: string; details?: NonNullable<object> } | null = null;

          if (typeof error === 'string') {
            e = { message: error }
          }
          else if (error instanceof HTTPClientError) {
            if (!this.config.retry.disabled && error.retryable) {
              const headers = message.headers
              const retryCount = headers?.retry_count ?? 0

              omnilog.debug('Retryable error', error, retryCount)
              const max_retries = this.config.retry.maxRetries
              if (retryCount < max_retries) {
                // Retryable error goes to DLX to wait for timeout
                await channel.publish('omni_tasks', deadLetterRoutingKey, message.content, { headers: { retry_count: retryCount + 1 } })
                // TODO: Signal the consumer that the message is being retried
                // e = { message: `${error.message} - Retrying ${max_retries - retryCount} more times`, details: error.originalError.details }
              } else {
                e = { message: error.message, details: error.originalError.details }
              }
            } else {
              e = { message: error.message, details: error.originalError.details }
            }
          }
          else if (error instanceof Error) {
            // @ts-ignore
            e = { message: error.message || error.toString(), details: error.details }
          }
          else {
            e = { message: JSON.stringify(error, null, 2) }
          }

          if (e) {
            this.enqueueFailure(payload.taskId, payload.shardId, e)
          }
        } finally {
          // Acknowledge the message to remove it from the queue.
          // TODO: We can do retry logic here
          channel.ack(message);
        }
      } catch (error: unknown) {
        omnilog.error(`Failed to process message with error: ${error}`, error);
        if (message) {
          let payload = null;
          try {
            payload = JSON.parse(message.content.toString());
          } catch (ex) {
            omnilog.error('Failed to parse message', message);
          }

          if (payload?.taskId && payload.shardId) {
            this.enqueueFailure(payload.taskId, payload.shardId, error as Error);
          }
          // Reject the message to requeue it

          channel.ack(message);
        }
      }
    });

    return true;
  }
}

export { RESTConsumerService, type RESTConsumerServiceConfig };
