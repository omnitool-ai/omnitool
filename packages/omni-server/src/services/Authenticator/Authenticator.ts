/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import crypto from 'crypto';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { type FastifyInstance, type FastifyPluginOptions, type FastifyReply, type FastifyRequest } from 'fastify';
import { type DBService } from '../DBService.js';
import { EObjectAction, Group, type ISetting, Organisation, User, Workflow, omnilog } from 'omni-shared';
import { generateId, hashPassword } from '../../helper/utils.js';
import { type IKVStorageConfig, KVStorage } from '../../core/KVStorage.js';
import { StorageAdapter } from '../../core/StorageAdapter.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

interface AuthenticatorConfig {
  autologin: boolean;
  admin: {
    username: string;
    password: string;
  };
  cloudflare: {
    publicKeyUrl: string;
    policyAud: string;
  };
  jwt: {
    secret: string;
  };
  kvStorage: IKVStorageConfig;
}

class Authenticator {
  private readonly _db: DBService;
  private _kvStorage?: KVStorage;
  private readonly _config: AuthenticatorConfig;
  private authHandlers: Record<string, Function> = {};

  constructor(db: DBService, config: AuthenticatorConfig) {
    omnilog.debug('Creating Authenticator: ', db ? 'db not null' : 'db is null');
    this._db = db;
    this._config = config;
  }

  get kvStorage() {
    if (!this._kvStorage) {
      throw new Error('KVStorage is not initialized');
    }
    return this._kvStorage;
  }

  async initialize() {
    const kvConfig = this._config.kvStorage;
    if (kvConfig) {
      this._kvStorage = new KVStorage(this._db.app, kvConfig);
      if (!(await this._kvStorage.init())) {
        throw new Error('KVStorage failed to start');
      }
      await this._kvStorage.vacuum();
    }

    this.authHandlers = {
      local: async (request: FastifyRequest, reply: FastifyReply) => {
        // @ts-ignore
        const { username, password } = request.body || {};
        try {
          const user = await this.authenticateWithUsernameAndPassword(username.toLowerCase(), password);
          return user;
        } catch (err) {
          return null;
        }
      },
      cloudflare: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const token = request.cookies.CF_Authorization;
          if (!token) {
            return null;
          }
          const user = await this.authenticateWithCloudFlareZeroTrustToken(token);
          return user;
        } catch (err) {
          return null;
        }
      },
      pb_admin: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const user = await this.authAsPocketbaseAdmin();
          return user;
        } catch (err) {
          return null;
        }
      },
      jwt: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const user = await this.authenticateJwt(request);
          return user;
        } catch (err) {
          omnilog.warn('authenticateJwt failed', err);
        }
      }
    };

    return fp(async (fastify: FastifyInstance, _options: FastifyPluginOptions) => {
      fastify.decorateRequest('user', null);
    });
  }

  private async getUserById(userId?: string): Promise<User | null> {
    if (userId) {
      const dbresult = await this._db.get(`user:${userId}`);
      if (dbresult) {
        const user = User.fromJSON(dbresult);
        // const groups = await getGroupByMemberId(this._db, userId)
        // groups.forEach(group => {
        //   if (group.name.toLowerCase() === 'admin') {
        //     user.tags.push('admin')
        //   }
        // })
        return user;
      }
    }
    return null;
  }

  authenticate(strategy: string | string[] = [], done?: (sessionId: string, user: User | null) => Promise<void>) {
    const strategies = Array.isArray(strategy) ? strategy : [strategy];

    return async (request: FastifyRequest, reply: FastifyReply) => {
      // @ts-ignore
      const user = await this.getUserById(request.session.userId);
      if (user) {
        request.user = user;
        request.user.settings.bindStorage(
          new StorageAdapter<ISetting<any>>(
            `settings:${request.user.id}`,
            this._kvStorage ?? new Map<string, ISetting<any>>()
          )
        );
        request.session.touch();
        return;
      }
      omnilog.debug('strategies', strategies.join(','));
      for (const s of strategies) {
        const handler = this.authHandlers[s];
        const user = await handler(request, reply);
        if (user) {
          // @ts-ignore
          request.session.userId = user.id;
          request.user = user;
          break;
        }
      }

      if (!request.user) {
        // All handler failed
        return await reply.status(401).send('Authentication failed');
      }

      request.user.settings.bindStorage(
        new StorageAdapter<ISetting<any>>(
          `settings:${request.user.id}`,
          this._kvStorage ?? new Map<string, ISetting<any>>()
        )
      );
      
      if (done) {
        await done(request.session.sessionId, request.user);
      }
    };
  }

  private async authenticateJwt(request: FastifyRequest): Promise<User|null> {
    const token = request.headers.authorization?.split(' ')[1];
    if (!token) {
      throw new Error('Unauthorized access');
    }

    try {
      const decoded = jwt.verify(token, this._config.jwt.secret);
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { scopes, issuerId, tokenId } = decoded;

      omnilog.debug('scopes', scopes);

      const user = await this.getUserById(issuerId);
      if (!user) {
        throw new Error("Invalid issuer")
      }

      // @ts-ignore
      request.session.set('permission', scopes);
      return user;
    } catch (err) {
      omnilog.error(err);
      throw new Error('Unauthorized access');
    }
  }

  private async authAsPocketbaseAdmin(): Promise<User | null> {
    omnilog.debug('autoLogin enabled? ', this._config.autologin);
    if (!this._config.autologin) {
      omnilog.warn('Autologin failed: not in single user mode.');
      return null;
    }

    const start = performance.now();
    // Try to login with pocketbase
    let user = await this._db.provider.authAsAdmin();
    if (user) {
      const end = performance.now();
      omnilog.info(`authWithAutologin in ${(end - start).toFixed(1)}ms`);
      return user;
    } 
    // User not exist, try to login with username and password
    user = await this.getUserByUsername(this._config.admin.username)
    if (user) {
      user = await this.authenticateWithUsernameAndPassword(this._config.admin.username, this._config.admin.password)
      if (user) {
        const end = performance.now();
        omnilog.info(`authWithAutologin in ${(end - start).toFixed(1)}ms`);
        return user;
      }
    }
    
    omnilog.debug('Creating new user')
    // There's no legacy user and it is a new install: create a new user with username and password
    const org = await this.createOrg('autologin');
    const group = await this.createAdminGroup('admin', org);
    const newUser = await this.createAndAddUserToOrg(this._config.admin.username, this._config.admin.password, null, null, group, org);
    const end = performance.now();
    omnilog.info(`authWithAutologin in ${(end - start).toFixed(1)}ms`);
    return newUser;
  }

  private async authenticateWithCloudFlareZeroTrustToken(token: string) {
    const start = performance.now();
    const client = jwksClient({
      jwksUri: this._config.cloudflare.publicKeyUrl
    });

    return await new Promise((resolve, reject) => {
      jwt.verify(
        token,
        function (header: any, callback: any) {
          client.getSigningKey(header.kid, function (err: any, key: any) {
            if (err) {
              callback(err);
            } else {
              // @ts-ignore
              const signingKey = key.getPublicKey();
              callback(null, signingKey);
            }
          });
        },
        {
          audience: this._config.cloudflare.policyAud,
          algorithms: ['RS256']
        },
        async (err, decoded) => {
          omnilog.debug('authenticateWithCloudFlareZeroTrustToken', decoded, err);
          if (err != null) {
            omnilog.error(err);
            const end = performance.now();
            omnilog.info(`authenticateWithCloudFlareZeroTrustToken error in ${(end - start).toFixed(1)}ms`);
            reject(err);
          } else {
            // @ts-ignore
            const cloudflareUserId = decoded.sub;
            if (cloudflareUserId && typeof cloudflareUserId === 'string') {
              const user = await this.getUserByExternalIdAndAuthType(cloudflareUserId, 'cloudflare');
              if (user != null) {
                const end = performance.now();
                omnilog.info(`authenticateWithCloudFlareZeroTrustToken  in ${(end - start).toFixed(1)}ms`);
                resolve(user);
              } else {
                // @ts-ignore
                const email = decoded.email;
                // Parse the email and take the user name
                const username = email.split('@')[0];
                const org = await this.createOrg('cloudflare');
                const group = await this.createAdminGroup('admin', org);
                const newUser = await this.createAndAddUserToOrg(username, null, cloudflareUserId, 'cloudflare', group, org);
                omnilog.debug('Created user: ', newUser);
                resolve(newUser);
              }
            } else {
              resolve(null);
            }
          }
        }
      );
    });
  }

  private async authenticateWithUsernameAndPassword(username: string, password: string): Promise<User | null> {
    const start = performance.now();
    // Local authentication
    const user = await this.getUserByUsername(username);

    if (user == null || !user.password || !user.salt) {
      const end = performance.now();
      omnilog.info(`authenticateWithUsernameAndPassword errors in ${(end - start).toFixed(1)}ms`);
      throw new Error('Incorrect username or password.');
    }

    const saltBuff = Buffer.from(user.salt, 'hex');
    const hashedPassword = hashPassword(password, saltBuff);
    if (!crypto.timingSafeEqual(Buffer.from(user.password, 'hex'), hashedPassword)) {
      const end = performance.now();
      omnilog.info(`authenticateWithUsernameAndPassword errors in ${(end - start).toFixed(1)}ms`);
      throw new Error('Incorrect username or password.');
    }

    const end = performance.now();
    omnilog.info(`authenticateWithUsernameAndPassword in ${(end - start).toFixed(1)}ms`);
    return user;
  }

  private async getUserByExternalIdAndAuthType(externalId: string, authType: string): Promise<User | null> {
    const start = performance.now();
    try {
      const query = {
        externalId,
        authType
      };

      const result = await this._db.find(query, undefined, undefined, undefined, undefined, 'externalId');
      if (result && result.length > 0) {
        const user = User.fromJSON(result[0]);
        const end = performance.now();
        omnilog.info(`getUserByExternalIdAndAuthType in ${(end - start).toFixed(1)}ms`);
        return user;
      }
      const end = performance.now();
      omnilog.info(`getUserByExternalIdAndAuthType empty in ${(end - start).toFixed(1)}ms`);
      return null;
    } catch (err) {
      const end = performance.now();
      omnilog.info(`getUserByExternalIdAndAuthType error in ${(end - start).toFixed(1)}ms`);
      return null;
    }
  }

  private async createOrg(name: string): Promise<Organisation> {
    // Create organization
    const newOrg = new Organisation(generateId(), name);
    newOrg.createdAt = Math.floor(Date.now() / 1000);
    newOrg.lastUpdated = Math.floor(Date.now() / 1000);
    return (await this._db.put(newOrg)) as Organisation;
  }

  private async createAdminGroup(name: string, org: Organisation): Promise<Group> {
    // Create admin group
    const newGroup = new Group(generateId(), name);
    newGroup.createdAt = Math.floor(Date.now() / 1000);
    newGroup.lastUpdated = Math.floor(Date.now() / 1000);
    newGroup.organisation = { id: org.id, name: org.name };
    newGroup.permission = [
      // Admin rights: r/w users from the same org
      {
        subject: User.modelName,
        action: [EObjectAction.CREATE, EObjectAction.READ, EObjectAction.UPDATE, EObjectAction.DELETE],
        conditions: [{ organisation: { id: org.id } }]
      },
      // Admin rights: r/w groups from the same org
      {
        subject: Group.modelName,
        action: [EObjectAction.CREATE, EObjectAction.READ, EObjectAction.UPDATE, EObjectAction.DELETE],
        conditions: [{ organisation: { id: org.id } }]
      },
      // Admin rights: r/w/x workflows of the same org
      {
        subject: Workflow.modelName,
        action: [
          EObjectAction.CREATE,
          EObjectAction.READ,
          EObjectAction.UPDATE,
          EObjectAction.DELETE,
          EObjectAction.EXECUTE
        ],
        conditions: [{ org: { id: org.id } }]
      }
    ];

    return (await this._db.put(newGroup)) as Group;
  }

  private async createAndAddUserToOrg(
    username: string,
    password: string | null,
    externalId: string | null,
    authType: string | null,
    group: Group | Group[],
    org: Organisation
  ): Promise<User> {
    const salt = crypto.randomBytes(16);

    // Create user
    const newUser = new User(generateId(), username.toLowerCase());
    // newUser.tier = tier // null is default / free tier
    newUser.organisation = { id: org.id, name: org.name };
    newUser.password = password ? hashPassword(password, salt).toString('hex') : null
    newUser.salt = salt.toString('hex');
    newUser.createdAt = Math.floor(Date.now() / 1000);
    newUser.lastUpdated = Math.floor(Date.now() / 1000);
    newUser.externalId = externalId;
    newUser.authType = authType;
    // TODO: Add more info on sign up
    await this._db.put(newUser);
    // Add user to default group
    if (!Array.isArray(group)) {
      if (group.name.toLowerCase() === 'admin') {
        newUser.tags.push('admin');
      }

      group.members.push({ id: newUser.id, name: newUser.username });
      await this._db.put(group);
    } else {
      for (const g of group) {
        if (g.name.toLowerCase() === 'admin') {
          newUser.tags.push('admin');
        }
        g.members.push({ id: newUser.id, name: newUser.username });
        await this._db.put(g);
      }
    }

    // Add user to organisation
    org.members.push({ id: newUser.id, name: newUser.username });
    await this._db.put(org);

    return newUser;
  }

  private async getUserByUsername(username: string): Promise<User | null> {
    try {
      const query = {
        username,
        password: { $exists: true }
      };
      const result = await this._db.find(query, undefined, undefined, undefined, undefined, 'username');
      if (result && result.length > 0) {
        const user = User.fromJSON(result[0]);
        // const groups = await getGroupByMemberId(this._db, user.id)
        // groups.forEach(group => {
        //   if (group.name.toLowerCase() === 'admin') {
        //     user.tags.push('admin')
        //   }
        // })
        return user;
      }
      return null;
    } catch (err) {
      return null;
    }
  }
}

export { Authenticator };
