/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import crypto from 'crypto';
import { existsSync, readFile, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import yaml from 'js-yaml';
import {
  APIKey,
  Organisation,
  Service,
  User,
  type IAPIKeyMetaData,
  type IServiceConfig,
  type ServiceManager
} from 'omni-shared';
import path from 'path';

import { AuthorizationCode } from 'simple-oauth2';
import { decrypt, encrypt, generateId } from '../../helper/utils.js';
import { type DBService } from '../DBService';
import { type BaseCredentialStore } from './Store/BaseCredentialStore.js';
import { KVCredentialStore } from './Store/KVCredentialStore.js';

import querystring from 'querystring';
import type MercsServer from '../../core/Server.js';

interface ICredentialServiceConfig extends IServiceConfig {
  opts?: any;
  disabled?: boolean;
  type: string;
  omniKeys: string;
  encryption: {
    keyPath: string;
    algorithm: string;
    signature: {
      keyPath: string;
      algorithm: string;
    }
  };
  store?: BaseCredentialStore;
  storeConfig: any;
  oauth: any;
}

class CredentialService extends Service {
  private readonly _store: BaseCredentialStore;
  private _encKey?: Buffer;
  private _hmacSecret?: Buffer;
  // private readonly _pbLogger: PocketBaseLogger

  constructor(id: string, manager: ServiceManager, config: ICredentialServiceConfig) {
    config.opts ??= {};
    super(id, manager, config || {});

    // RAII
    if (this.serviceConfig.encryption) {
      this.initKey(this.serviceConfig.encryption.keyPath);
    }

    // Signature enabled
    if (this.serviceConfig.encryption?.signature) {
      this.initHmacSecret(this.serviceConfig.encryption.signature.keyPath);
    }

    this._store = config.store ?? new KVCredentialStore(this, config.storeConfig);
    // this._pbLogger = new PocketBaseLogger({
    //   pbUrl: 'http://127.0.0.1:8090',
    //   defaults: {
    //     tag: id,
    //   }
    // })
  }

  get serviceConfig() {
    return this.config as ICredentialServiceConfig;
  }

  get server(): MercsServer {
    return this.manager.app as MercsServer;
  }

  async hasSecret(userId: string, apiNamespace: string): Promise<boolean> {
    const db = this.app.services.get('db') as DBService;
    if (!db) {
      throw new Error('hasSecret() failed: DB service not initialized');
    }

    const user = (await db.get(`user:${userId}`)) as User;
    if (user == null) {
      //throw new Error(`User ${userId} not found`)
      this.info(`User ${userId} not found`);
      return false;
    }

    const blockManager = this.server.blocks;
    const requiredCredentials = blockManager.getRequiredCredentials(apiNamespace, false); // check only the non-optional credentials

    const hasAllRequiredKey = requiredCredentials.reduce(async (previousPromise, tokenType) => {
      const hasAllRequiredKeySoFar = await previousPromise;
      if (!hasAllRequiredKeySoFar) return false;

      let apiKey = await this.getCredentialMetadata(user.id, User.modelName, apiNamespace, tokenType.id);
      if (!apiKey) {
        this.info(`No credential found for user ${user.id} namespace ${apiNamespace} type ${tokenType.id}`);
        // Fallback to org level key
        const orgId = user.organisation?.id;
        if (orgId) {
          apiKey = await this.getCredentialMetadata(orgId, Organisation.modelName, apiNamespace, tokenType.id);
        }
      }

      if (!apiKey) {
        this.info(
          `No credential found for org ${user.organisation?.id} namespace ${apiNamespace} type ${tokenType.id}`
        );
        // Fallback to omni key
        apiKey = await this.getCredentialMetadata('omni', 'omni', apiNamespace, tokenType.id);
      }

      return !!apiKey;
    }, Promise.resolve(true));

    return await hasAllRequiredKey;
  }

  async get(userId: string, apiNamespace: string, baseUrl: string, tokenType: string): Promise<string> {
    const db = this.app.services.get('db') as DBService;
    if (!db) {
      throw new Error('Get credential failed: DB service not initialized');
    }

    omnilog.info(`Getting credential for user ${userId} namespace ${apiNamespace} type ${tokenType}`);

    const user = (await db.get(`user:${userId}`)) as User;
    if (user == null) {
      throw new Error(`User ${userId} not found`);
    }

    let apiKey = await this.getCredentialMetadata(user.id, User.modelName, apiNamespace, tokenType);
    if (!apiKey) {
      this.info(`No credential found for user ${user.id} namespace ${apiNamespace} type ${tokenType}`);
      // Fallback to org level key
      const orgId = user.organisation?.id;
      if (orgId) {
        apiKey = await this.getCredentialMetadata(orgId, Organisation.modelName, apiNamespace, tokenType);
      }
    }

    if (!apiKey) {
      this.info(`No credential found for org ${user.organisation?.id} namespace ${apiNamespace} type ${tokenType}`);
      // Fallback to omni key
      apiKey = await this.getCredentialMetadata('omni', 'omni', apiNamespace, tokenType);
    }

    if (apiKey) {
      // Get API key from the vault
      const secret = await this._store.getSecret(apiKey.key);
      if (secret) {
        if (this.serviceConfig.encryption) {
          if (this._encKey) {
            const url = new URL(baseUrl);
            // Decrypt the secret
            const decipher = decrypt(secret, this._encKey, this.serviceConfig.encryption.algorithm, this._hmacSecret ? { hmacSecret: this._hmacSecret, data: url.host } : undefined);
            if (decipher) {
              return decipher;
            }
          }
          throw new Error('Failed to decrypt secret');
        } else {
          return secret;
        }
      }
    }

    throw new Error(`No credential found for namespace ${apiNamespace} type ${tokenType}`);
  }

  async storeSecret(
    secret: string,
    ownerId: string,
    ownerType: string,
    apiNamespace: string,
    tokenType: string,
    secretName?: string
  ): Promise<boolean> {
    let cipher = secret;
    if (this.serviceConfig.encryption) {
      if (this._encKey) {
        // Get base URL from block manager
        const blockManager = this.server.blocks;
        const baseUrl = blockManager.getNamespace(apiNamespace)?.api?.basePath ?? '';
        // Encrypt the secret
        cipher = encrypt(secret, this._encKey, this.serviceConfig.encryption.algorithm, this._hmacSecret ? { hmacSecret: this._hmacSecret, data: new URL(baseUrl).host } : undefined);
        if (!cipher) {
          throw new Error('Failed to encrypt secret');
        }
      } else {
        throw new Error('Failed to encrypt secret');
      }
    }

    const vaultKey = this.generateVaultKey(ownerId, ownerType, apiNamespace, tokenType);
    const result = await this._store.setSecret(cipher, vaultKey);
    await this.createCredentialDetails(ownerId, ownerType, apiNamespace, tokenType, vaultKey);

    await this.server.emit('credential_change', {});
    return result;
  }

  generateVaultKey(
    ownerId: string,
    ownerType: string,
    apiNamespace: string,
    tokenType: string,
    secretName?: string
  ): string {
    return `${ownerType}:${ownerId}:${apiNamespace}:${tokenType}`.concat(secretName ? `:${secretName}` : '');
  }

  async setUserCredential(user: User, apiNamespace: string, tokenType: string, secret: string): Promise<boolean> {
    if (!user || !apiNamespace || !tokenType || !secret) {
      return false;
    }
    // Check if the credential already exists
    const apiKey = await this.getCredentialMetadata(user.id, User.modelName, apiNamespace, tokenType);
    if (apiKey) {
      // Credential already exists, revoke it and create a new one
      await this.revokeUserCredentials(user, apiNamespace, tokenType);
    }
    return await this.storeSecret(secret, user.id, User.modelName, apiNamespace, tokenType);
  }

  async setOrgCredential(org: Organisation, apiNamespace: string, tokenType: string, secret: string): Promise<void> {
    // Check if the credential already exists
    const apiKey = await this.getCredentialMetadata(org.id, Organisation.modelName, apiNamespace, tokenType);
    if (apiKey) {
      // Credential already exists, revoke it and create a new one
      await this.revokeOrgCredentials(org, apiNamespace, tokenType);
    }

    await this.storeSecret(secret, org.id, Organisation.modelName, apiNamespace, tokenType);
  }

  async revokeOrgCredentials(org: Organisation, apiNamespace: string, tokenType: string): Promise<void> {
    const apiKey = await this.getCredentialMetadata(org.id, Organisation.modelName, apiNamespace, tokenType);
    if (apiKey) {
      // Delete the secret from the vault
      if (await this._store.deleteSecret(apiKey.key)) {
        // Revoke the credential
        await this.revokeCredentials(apiKey);
      }
    }
  }

  async revokeUserCredentials(user: User, apiNamespace: string, tokenType: string): Promise<boolean> {
    const apiKey = await this.getCredentialMetadata(user.id, User.modelName, apiNamespace, tokenType);
    if (apiKey) {
      // Delete the secret from the vault
      if (await this._store.deleteSecret(apiKey.key)) {
        // Revoke the credential
        await this.revokeCredentials(apiKey);
        return true;
      }
    }

    return false;
  }

  async getCredentialMetadata(
    ownerId: string,
    ownerType: string,
    apiNamespace: string,
    tokenType: string
  ): Promise<APIKey | undefined> {
    const vaultType = (this.config as ICredentialServiceConfig).type;
    const query = {
      $or: [
        {
          owner: `${ownerType}:${ownerId}`,
          meta: {
            revoked: false
          },
          apiNamespace,
          variableName: tokenType,
          vaultType
        }
      ]
    };

    const dbService = this.app.services.get('db') as DBService;
    const result = await dbService.find(query);
    if (result && result.length > 0) {
      return result[0];
    }
  }

  async createCredentialDetails(
    ownerId: string,
    ownerType: string,
    apiNamespace: string,
    variableName: string = 'token',
    credentialKey: string
  ): Promise<void> {
    const apiKey = new APIKey(generateId());
    apiKey.meta.name = apiNamespace; // TODO: User should be able to name and add description for their key
    apiKey.meta.description = `User API Key for ${apiNamespace}`; // TODO: User should be able to name and add description for their key
    apiKey.owner = `${ownerType}:${ownerId}`;
    apiKey.key = credentialKey;
    apiKey.vaultType = (this.config as ICredentialServiceConfig).type;
    apiKey.apiNamespace = apiNamespace;
    apiKey.variableName = variableName;

    this.debug('Saving API key metadata:', JSON.stringify(apiKey, null, 2));

    const db: DBService = this.app.services.get('db') as DBService;

    if (db) {
      try {
        await db.put(apiKey);
      } catch (err) {
        this.error('Error saving API key metadata:', err);
        throw new Error('Error saving API key');
      }
    }
  }

  async revokeCredentials(apiKeyDetails: APIKey): Promise<void> {
    const dbService = this.app.services.get('db') as DBService;
    if (apiKeyDetails._id) {
      const apiKeyToBeRevoked = (await dbService.get(apiKeyDetails._id)) as APIKey;
      if (apiKeyToBeRevoked) {
        apiKeyToBeRevoked.meta.revoked = true;
        await dbService.put(apiKeyToBeRevoked);

        await this.server.emit('credential_change', {});
      }
    }
  }

  async listKeyMetadata(
    ownerId: string,
    ownerType: string
  ): Promise<Array<{ meta: IAPIKeyMetaData; apiNamespace: string; tokenType: string }>> {
    // Query db for all the keys owned by the user
    const db: DBService = this.app.services.get('db') as DBService;
    const query = {
      $or: [
        {
          owner: `${ownerType}:${ownerId}`,
          meta: {
            revoked: false
          }
        }
      ]
    };

    const result = await db.find(query);

    return result.map((key: APIKey) => {
      return {
        meta: key.meta,
        tokenType: key.variableName,
        owner: key.owner,
        apiNamespace: key.apiNamespace
      };
    });
  }

  async generateAuthUrl(user: User, apiNamespace: string): Promise<string> {
    const clientId = this.app.settings.get<string>(`omni:api.oauth.${apiNamespace}.client.id`)?.value;
    const clientSecret = this.app.settings.get<string>(`omni:api.oauth.${apiNamespace}.client.secret`)?.value;

    if (!clientId || !clientSecret) {
      throw new Error('No client credentials found');
    }

    const blockManager = this.server.blocks;
    const oauthSecuritySchemes = await blockManager.searchSecurityScheme(
      apiNamespace,
      undefined,
      'oauth2',
      'authorizationCode'
    );

    if (!oauthSecuritySchemes || oauthSecuritySchemes.length <= 0) {
      throw new Error('OAuth 2.0 security scheme not found');
    }

    // TODO: This assumes each namespace has only 1 oauth authorization code scheme
    const oauth2Scheme = oauthSecuritySchemes[0];

    if (!oauth2Scheme?.oauth?.authorizationCode) {
      throw new Error('No oauth2 scheme authorization code found');
    }

    const authCodeScheme = oauth2Scheme.oauth?.authorizationCode;
    if (authCodeScheme.tokenUrl == null) {
      throw new Error('No oauth2 token url found');
    }

    // For each of the security schemes, if it is an oauth2 authorization scheme, get the scopes
    // TODO this is assuming all the oauth2 schemes have the same auth and token urls
    const scopes = new Set<string>();
    for (const securityScheme of oauthSecuritySchemes) {
      const authCodeScheme = securityScheme.oauth?.authorizationCode;
      if (authCodeScheme?.scopes != null) {
        for (const scope of authCodeScheme.scopes) {
          scopes.add(scope);
        }
      }
    }

    // Additional optional params to be sent to the oauth2 provider
    const opts = this.serviceConfig.oauth[apiNamespace].opts;

    const oauth2client = new AuthorizationCode({
      client: {
        id: clientId,
        secret: clientSecret
      },
      auth: {
        tokenHost: new URL(authCodeScheme.tokenUrl).origin,
        tokenPath: new URL(authCodeScheme.tokenUrl).pathname,
        refreshPath: authCodeScheme.refreshUrl ? new URL(authCodeScheme.refreshUrl).pathname : undefined,
        authorizeHost: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).origin : undefined,
        authorizePath: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).pathname : undefined
      }
    });

    return oauth2client
      .authorizeURL({
        // @ts-ignore
        redirect_uri: `${this.app.config.network.public_url}/api/v1/auth/oauth2/${apiNamespace}/callback`,
        scope: Array.from(scopes)
      })
      .concat(`${opts ? '&' + querystring.stringify(opts) : ''}`);
  }

  async generateAccessToken(user: User, apiNamespace: string, code: string, scopes: string[]): Promise<true> {
    const clientId = this.app.settings.get<string>(`omni:api.oauth.${apiNamespace}.client.id`)?.value;
    const clientSecret = this.app.settings.get<string>(`omni:api.oauth.${apiNamespace}.client.secret`)?.value;

    if (!clientId || !clientSecret) {
      throw new Error('No client credentials found');
    }

    const blockManager = this.server.blocks;
    const oauthSecuritySchemes = await blockManager.searchSecurityScheme(
      apiNamespace,
      undefined,
      'oauth2',
      'authorizationCode'
    );

    if (!oauthSecuritySchemes || oauthSecuritySchemes.length <= 0) {
      throw new Error('OAuth 2.0 security scheme not found');
    }

    // TODO: This assumes each namespace has only 1 oauth authorization code scheme
    const oauth2Scheme = oauthSecuritySchemes[0];

    if (!oauth2Scheme?.oauth?.authorizationCode) {
      throw new Error('No oauth2 scheme authorization code found');
    }

    const authCodeScheme = oauth2Scheme.oauth?.authorizationCode;
    if (authCodeScheme.tokenUrl == null) {
      throw new Error('No oauth2 token url found');
    }

    const oauth2client = new AuthorizationCode({
      client: {
        id: clientId,
        secret: clientSecret
      },
      auth: {
        tokenHost: new URL(authCodeScheme.tokenUrl).origin,
        tokenPath: new URL(authCodeScheme.tokenUrl).pathname,
        refreshPath: authCodeScheme.refreshUrl ? new URL(authCodeScheme.refreshUrl).pathname : undefined,
        authorizeHost: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).origin : undefined,
        authorizePath: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).pathname : undefined
      }
    });

    const tokenParams = {
      code,
      // @ts-ignore
      redirect_uri: `${this.app.config.network.public_url}/api/v1/auth/oauth2/${apiNamespace}/callback`,
      scope: scopes
    };

    try {
      const accessToken = await oauth2client.getToken(tokenParams);
      await this.setUserCredential(user, apiNamespace, 'accessToken', JSON.stringify(accessToken));
      return true;
    } catch (err) {
      console.error('Access Token Error', err);
      throw new Error('Access Token Error');
    }
  }

  // This method will try to refresh when token is expired
  async getOAuth2AccessToken(userId: string, apiNamespace: string, url: string): Promise<string> {
    const db = this.app.services.get('db') as DBService;
    if (!db) {
      throw new Error('Get credential failed: DB service not initialized');
    }

    const user = (await db.get(`user:${userId}`)) as User;
    if (user == null) {
      throw new Error(`User ${userId} not found`);
    }

    const blockManager = this.server.blocks;
    const oauthSecuritySchemes = await blockManager.searchSecurityScheme(
      apiNamespace,
      undefined,
      'oauth2',
      'authorizationCode'
    );

    if (!oauthSecuritySchemes || oauthSecuritySchemes.length <= 0) {
      throw new Error('OAuth 2.0 security scheme not found');
    }

    // TODO: This assumes each namespace has only 1 oauth authorization code scheme
    const oauth2Scheme = oauthSecuritySchemes[0];

    if (!oauth2Scheme?.oauth?.authorizationCode) {
      throw new Error('No oauth2 scheme authorization code found');
    }

    const authCodeScheme = oauth2Scheme.oauth?.authorizationCode;
    if (authCodeScheme.tokenUrl == null) {
      throw new Error('No oauth2 token url found');
    }

    // For each of the security schemes, if it is an oauth2 authorization scheme, get the scopes
    // TODO this is assuming all the oauth2 schemes have the same auth and token urls
    const scopes = new Set<string>();
    for (const securityScheme of oauthSecuritySchemes) {
      const authCodeScheme = securityScheme.oauth?.authorizationCode;
      if (authCodeScheme?.scopes != null) {
        for (const scope of authCodeScheme.scopes) {
          scopes.add(scope);
        }
      }
    }

    const clientId = this.app.settings.get<string>(`omni:api.oauth.${apiNamespace}.client.id`)?.value;
    const clientSecret = this.app.settings.get<string>(`omni:api.oauth.${apiNamespace}.client.secret`)?.value;

    if (!clientId || !clientSecret) {
      throw new Error('No client credentials found');
    }

    const oauth2client = new AuthorizationCode({
      client: {
        id: clientId,
        secret: clientSecret
      },
      auth: {
        tokenHost: new URL(authCodeScheme.tokenUrl).origin,
        tokenPath: new URL(authCodeScheme.tokenUrl).pathname,
        refreshPath: authCodeScheme.refreshUrl ? new URL(authCodeScheme.refreshUrl).pathname : undefined,
        authorizeHost: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).origin : undefined,
        authorizePath: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).pathname : undefined
      }
    });

    const accessTokenStr = await this.get(user.id, apiNamespace, new URL(url).host, 'accessToken');
    const accessToken = oauth2client.createToken(JSON.parse(accessTokenStr));

    if (accessToken.expired()) {
      try {
        omnilog.debug('Refreshing token', JSON.stringify(accessToken));
        const refreshedToken = await accessToken.refresh({ scope: Array.from(scopes) });
        omnilog.debug('Refreshed token', JSON.stringify(refreshedToken));
        // After refreshing the token, if the refresh token is not returned, we keep the old refresh token
        // (Google only returns refresh token once when the user consents)
        refreshedToken.token = {
          ...refreshedToken.token,
          refresh_token: refreshedToken.token.refresh_token ?? accessToken.token.refresh_token
        };
        await this.setUserCredential(user, apiNamespace, 'accessToken', JSON.stringify(refreshedToken));
        return `${refreshedToken.token.token_type} ${refreshedToken.token.access_token}`;
      } catch (err) {
        console.error('Refresh Token Error', err);
        throw new Error('Refresh Token Error');
      }
    }

    return `${accessToken.token.token_type} ${accessToken.token.access_token}`;
  }

  // Service load fires when the service is loaded. Other services may not be available at this point
  async load(): Promise<boolean> {
    this.info('credential service loading...');
    // await this._pbLogger.init()

    await this._store.init();

    try {
      await this.loadOmniKeystore();
    } catch (err) {
      this.error('Error loading omni keystore', err);
    }

    // Try migrating credentials from old format (no signature) to new format (with signature)
    try {
      await this.migrateCredentials();
    } catch (err) {
      this.error('Error migrating credentials: you may need to revoke and re-add your credentials', err);
    }

    return true;
  }

  private async migrateCredentials () {
    if (!this._encKey || !this._hmacSecret) {
      this.info('Encryption key or signature is not enabled, skipping migration')
      return
    }

    const dbService = this.app.services.get('db') as DBService;
    const query = {
      _id: {
        $gte: `${APIKey.modelName}:`, // i.e. _id.startswith(userId + ':')
        $lt: `${APIKey.modelName}:\u10FFFF`
      },  
      meta: {
        revoked: false
      }
    };

    const result = await dbService.find(query);
    if (result && result.length > 0) {
      for (const apiKey of result) {
        // Get API key from the vault
        const secret = await this._store.getSecret(apiKey.key);
        if (secret) {
          // Split the data into its components
          const textParts = secret.split(':');
          if (textParts.length < 3) {
            // Decrypt the secret
            const decipher = decrypt(secret, this._encKey, this.serviceConfig.encryption.algorithm);
            if (decipher) {
              const blockManager = this.server.blocks;
              const baseUrl = blockManager.getNamespace(apiKey.apiNamespace)?.api?.basePath ?? '';
              // Encrypt the secret
              const cipher = encrypt(decipher, this._encKey, this.serviceConfig.encryption.algorithm, { hmacSecret: this._hmacSecret, data: new URL(baseUrl).host });
              if (cipher) {
                // Store the secret back to the vault
                await this._store.setSecret(cipher, apiKey.key);
              }
            }
          }
        }
      }
    }
  }

  initKey(keyPath: string) {
    if (!this.serviceConfig.encryption) {
      return; // Dont init key by accident
    }

    if (!existsSync(keyPath)) {
      // If key file does not exist, generate a new key and write it to the file
      ensureDirSync(path.dirname(keyPath));
      writeFileSync(keyPath, crypto.randomBytes(32));

      // TODO: chmodSync(keyPath, 0o600);
    }

    this._encKey = readFileSync(keyPath);

    if (this._encKey?.length < 32) {
      omnilog.error('Encryption key failed to init');
      process.exit(-78);
    }
  }

  initHmacSecret(hmacSecretPath: string) {
    if (!existsSync(hmacSecretPath)) {
      // If key file does not exist, generate a new key and write it to the file
      ensureDirSync(path.dirname(hmacSecretPath));
      writeFileSync(hmacSecretPath, crypto.randomBytes(32));

      // TODO: chmodSync(keyPath, 0o600);
    }

    this._hmacSecret = readFileSync(hmacSecretPath);

    if (this._hmacSecret?.length < 32) {
      omnilog.error('HMAC secret key failed to init');
      process.exit(-78);
    }
  }

  async loadOmniKeystore() {
    if (existsSync(this.serviceConfig.omniKeys)) {
      const credentials = yaml.load(readFileSync(this.serviceConfig.omniKeys, 'utf8')) as Record<
        string,
        Record<string, string>
      >;
      this.info(`Importing keystore from ${this.serviceConfig.omniKeys}`);
      if (credentials) {
        // Load credentials
        for (const ns in credentials) {
          // iterate through all the tokens for each namespace
          for (const token in credentials[ns]) {
            if (!JSON.stringify(credentials[ns][token]).includes('xxxxxxxxxxxxx')) {
              const apiKeyDetails = await this.getCredentialMetadata('omni', 'omni', ns, token);
              if (apiKeyDetails) {
                // Credential already exists, revoke it and create a new one
                if (await this._store.deleteSecret(apiKeyDetails.key)) {
                  await this.revokeCredentials(apiKeyDetails);
                }
              }
              await this.storeSecret(credentials[ns][token], 'omni', 'omni', ns, token);
            } else {
              this.warn(`Invalid credentials for key '${ns} ${token}'`);
            }
          }
        }
      } else {
        this.info('No credentials found');
      }

      // Delete the file after importing
      unlinkSync(this.serviceConfig.omniKeys);
    } else {
      omnilog.info(`No ${this.serviceConfig.omniKeys} file found at repository root`);
    }
  }
}

export { CredentialService, type ICredentialServiceConfig };
