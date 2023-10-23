/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// -----------------------------------------------------------------------------------------------
// FastifyServerService
//
//  Purpose: This service adds a fastify webserver instance to the server app.
//
//  Usage:
//  1. Add the service to the server app
//     e.g. server.use(FastifyServerService, {id: 'service_id' }))
// -----------------------------------------------------------------------------------------------

import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifySession from '@fastify/session';
import fastifyStatic from '@fastify/static';
import fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

import { FastifySSEPlugin } from 'fastify-sse-v2';
import { Service, type IAPISignature, type IServiceConfig, type ServiceManager, type User } from 'omni-shared';
import path from 'path';

import proxy from '@fastify/http-proxy';
import multipart from '@fastify/multipart';
import { Authenticator } from './Authenticator/Authenticator.js';

import { KVStorage, type IKVStorageConfig } from '../core/KVStorage.js';
import { CustomMemoryStore } from './Session/CustomMemoryStore.js';
import { KVSessionStore } from './Session/KVSessionStore.js';
import { type DBService } from './DBService.js';
import { type AuthIntegration } from 'integrations/Authentication/AuthIntegration';

interface FastifyServerServiceConfig extends IServiceConfig {
  opts?: any;
  listen: {
    host: string;
    port: number;
  };
  cors: {
    origin: boolean | string | RegExp | Array<string | RegExp>;
    credentials: boolean;
  };
  proxy: {
    enabled: boolean;
    viteDebugger: string;
  };
  autologin: boolean;
  plugins: {};
  session: {
    secret: string;
    cookie: {
      secure: boolean;
      httpOnly: boolean;
      maxAge: number;
      sameSite?: 'Strict' | 'Lax' | 'None';
    };
    kvStorage?: IKVStorageConfig;
  };
  rateLimit: {
    global: boolean;
    max: number;
    timeWindow: number;
  };
}

class FastifyServerService extends Service {
  protected fastifyInstance: any;
  protected authenticator?: Authenticator;
  protected _kvStorage?: KVStorage;

  constructor(id: string, manager: ServiceManager, config: FastifyServerServiceConfig) {
    config.opts ??= {};
    config.listen ??= { host: '0.0.0.0', port: 3000 };
    config.cors ??= { origin: true, credentials: false };
    config.session ??= {
      secret: 'secret that is more than 32 characters',
      cookie: { secure: false, httpOnly: false, maxAge: 1000 * 60 * 30 }
    };

    super(id, manager, config || {});
  }

  // -----------------------------------------------------------------------------------------------
  // addRoute
  //
  //  Purpose:
  //    Adds an api route to the fastify service with the specificed method and handler function
  //
  //    Optionally supports schema and websocket support.
  //
  //    See https://www.fastify.io/docs/latest/Reference/Routes/
  // -----------------------------------------------------------------------------------------------
  async addRoute({ url, method, handler, insecure, authStrategy, schema, websocket, config }: IAPISignature) {
    method ??= 'GET';
    schema ??= null;
    const preValidation = insecure
      ? undefined
      : this.authenticator?.authenticate(authStrategy, async (sessionId: string, user: User | null) => {
          await this.emitGlobalEvent('session_created', [sessionId, user]);
        });

    if (websocket === true) {
      // TODO: this is half baked and untested.
      this.warn('addRoute (websocket) is half baked and untested.');
      this.fastifyInstance.get(url, { websocket: true }, handler);
      this.verbose('api route added', method, url, handler, '(websocket enabled)');
    } else {
      this.fastifyInstance.route({ url, method, preValidation, handler, schema, config });
      this.debug('api route added', method, url, insecure, preValidation, authStrategy, handler);
    }
  }

  get serviceConfig() {
    return this.config as FastifyServerServiceConfig;
  }

  async create() {
    this.verbose(`service ${this.id} creating...`);

    this.fastifyInstance = fastify((this.config as FastifyServerServiceConfig).opts);
    this.registerCORSHandler();
    this.registerRateLimiter();
    const kvStoreConfig = (this.config as FastifyServerServiceConfig).session.kvStorage;
    if (kvStoreConfig != null) {
      this._kvStorage = new KVStorage(this, kvStoreConfig);
      if (!(await this._kvStorage.init())) {
        throw new Error('KVStorage failed to start');
      }
      await this._kvStorage.vacuum();
    }

    // Setup session store
    let sessionStore;
    if (this._kvStorage != null) {
      sessionStore = new KVSessionStore(this._kvStorage, async (sid: string, userId: string) => {
        await this.emitGlobalEvent('session_expired', [sid, userId]);
      });
    } else {
      sessionStore = new CustomMemoryStore(async (sid: string, userId: string) => {
        await this.emitGlobalEvent('session_destroyed', [sid, userId]);
      });
    }

    this.fastifyInstance.addHook('onSend', (request: any, reply: any, payload: any, next: any) => {
      reply.header('X-Frame-Options', 'SAMEORIGIN');
      reply.header('Cross-Origin-Opener-Policy', 'same-origin');
      reply.header('Cross-Origin-Embedder-Policy', 'credentialless'); /*require-corp*/
      next();
    });

    // Setup fastify session
    this.fastifyInstance.register(fastifyCookie);
    this.fastifyInstance.register(fastifySession, {
      store: sessionStore,
      secret: this.app.settings.get('omni:network.session.secret')?.value,
      // secret: this.serviceConfig.session.secret,
      cookieName: 'sessionId',
      cookie: {
        secure: (this.config as FastifyServerServiceConfig).session.cookie.secure,
        httpOnly: (this.config as FastifyServerServiceConfig).session.cookie.httpOnly,
        maxAge: (this.config as FastifyServerServiceConfig).session.cookie.maxAge,
        sameSite: (this.config as FastifyServerServiceConfig).session.cookie.sameSite ?? 'Lax'
      }
    });

    // Setup Fastify Passport
    // this.fastifyPassport = new Authenticator()
    const db = this.app.services.get('db') as DBService;

    this.authenticator = new Authenticator(db, {
      //@ts-ignore
      jwt: {
        secret: this.app.settings.get<string>('omni:auth.jwt.secret')?.value || ''
      },
      //@ts-ignore
      discord: this.app.config.integrations?.auth?.discord,
      //@ts-ignore
      cloudflare: this.app.config.integrations?.auth?.cloudflare,
      autologin: this.serviceConfig.autologin,
      //@ts-ignore
      kvStorage: this.app.config.integrations?.auth?.kvStorage
    });
    this.fastifyInstance.register(this.authenticator.initialize());

    this.subscribeToGlobalEvent('registerAPI', this.addRoute.bind(this));

    this.debug(`service ${this.id} created`);
    return true;
  }

  registerRateLimiter() {
    const fastifyConfig = this.config as FastifyServerServiceConfig;
    this.fastifyInstance.register(rateLimit, {
      global: fastifyConfig.rateLimit.global,
      max: fastifyConfig.rateLimit.max,
      timeWindow: fastifyConfig.rateLimit.timeWindow,
      onExceeding: (req: FastifyRequest, key: string) => {
        this.error(`Rate limit exceeded for ${req.ip} on ${req.url} with key ${key}`);
      }
    });
  }

  registerCORSHandler() {
    const fastifyConfig = this.config as FastifyServerServiceConfig;
    switch (fastifyConfig.listen.host) {
      case '127.0.0.1':
        // skip local
        break;
      default:
        if (fastifyConfig.cors.origin === true) {
          this.warn(
            'Fastify configuration: CORS origin is set to true, this is not recommended for production use as it creates security risks.'
          );
        }
        this.fastifyInstance.register(cors, {
          origin: fastifyConfig.cors.origin,
          credentials: fastifyConfig.cors.credentials
        });
        break;
    }
  }

  registerStaticHandler() {
    const config = this.config as FastifyServerServiceConfig;
    if (config.proxy.enabled) {
      this.fastifyInstance.register(proxy, {
        upstream: config.proxy.viteDebugger,
        http: true,
        websocket: true
      });
      this.fastifyInstance.register(proxy, {
        upstream: 'http://127.0.0.1:8090/',
        http: true,
        prefix: '/db/',
        websocket: true,
        preValidation: async (request: any, reply: any) => {
          const user = request.user;
          const auth = this.app.integrations.get('auth') as AuthIntegration;
          if (!(await auth.isAdmin(user))) {
            return reply.code(403).send({ message: 'Not admin' });
          }
        }
      });
    } else {
      this.info(`${this.id} static path ${path.join(process.cwd(), 'public/')}`);
      this.fastifyInstance.register(fastifyStatic, {
        root: path.join(process.cwd(), 'public/'),
        prefix: '/' // optional: default '/'
      });
    }
  }

  async load() {
    const service = this;
    this.debug(`service ${this.id} loading...`);
    // Install form body parser plugin
    // this.fastifyInstance.register(fastifyFormbody)
    this.fastifyInstance.register(multipart);

    this.registerStaticHandler();
    await this.emit('onRegisterStatics', { fastifyInstance: this.fastifyInstance, fastifyStatic });

    this.fastifyInstance.register(FastifySSEPlugin);

    this.fastifyInstance.setErrorHandler(function (error: Error, _request: any, reply: any) {
      // if (error instanceof fastify.errorCodes.FST_ERR_BAD_STATUS_CODE) {
      // Log error
      omnilog.trace(error);
      service.error(error);
      // Send error response
      reply.status(500).send({ ok: false });
      // }
    });

    await this.emit('registerMiddleware', [this.fastifyInstance, this]);
    this.success(`service ${this.id} loaded`);
    return true;
  }

  async start() {
    this.debug(`service ${this.id} starting...`);
    await this.fastifyInstance.listen((this.config as FastifyServerServiceConfig).listen);
    this.success(`service ${this.id} started`);
    return true;
  }

  async stop() {
    this.debug(`service ${this.id} stopping...`);
    await this.fastifyInstance.close();
    this.success(`service ${this.id} stopped.`);
    return true;
  }
}

export { FastifyServerService, type FastifyServerServiceConfig };
