/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { convertMapsToObjects } from '../../../helper/utils.js';
import yaml from 'js-yaml';

/**
 * Base class for credential storage
 */
abstract class BaseCredentialStore {
  abstract init(): Promise<void> | void;
  abstract getSecret(vaultKey: string): Promise<string | undefined> | string | undefined;
  abstract setSecret(secret: string, vaultKey?: string): Promise<boolean>;
  abstract deleteSecret(vaultKey: string): Promise<boolean> | boolean;
}

interface ILocalFileCredentialStoreConfig {
  keystore: string;
}

class LocalFileCredentialStore extends BaseCredentialStore {
  private readonly _config: ILocalFileCredentialStoreConfig;
  private readonly _vault: Map<string, string>;

  constructor(config: ILocalFileCredentialStoreConfig) {
    super();
    this._config = config;
    this._vault = new Map<string, string>();
  }

  async init(): Promise<void> {
    this.loadCredentials(`${this._config.keystore ?? './data.local/keystore'}/vault.yaml`);
  }

  loadCredentials(file: string): void {
    if (existsSync(file)) {
      const credentials = yaml.load(readFileSync(file, 'utf8')) as Record<string, string>;
      omnilog.info(`Importing keystore from ${file}`);
      if (credentials) {
        // Load credentials
        for (const key in credentials) {
          if (Object.prototype.hasOwnProperty.call(credentials, key)) {
            if (!credentials[key].includes('xxxxxxxxxxxxx')) {
              this._vault.set(key, credentials[key]);
            } else {
              throw new Error(`Invalid credentials for key '${key}'`);
            }
          }
        }
      } else {
        omnilog.warn('No credentials found');
      }
    } else {
      omnilog.warn(`No ${file} file found at repository root`);
    }
  }

  getSecret(vaultKey: string): string | undefined {
    return this._vault.get(vaultKey);
  }

  async setSecret(secret: string, vaultKey?: string): Promise<boolean> {
    if (vaultKey) {
      this._vault.set(vaultKey, secret);
      this.flushToFile();
      return true;
    }

    throw new Error('Vault key is required');
  }

  deleteSecret(vaultKey: string): boolean {
    this._vault.delete(vaultKey);
    try {
      this.flushToFile();
      return true;
    } catch (error) {
      omnilog.error('Error deleting ciphers:', error);
      return false;
    }
  }

  private flushToFile(): void {
    try {
      ensureDirSync(this._config.keystore);
      writeFileSync(`${this._config.keystore}/vault.yaml`, yaml.dump(convertMapsToObjects(this._vault)));
    } catch (err) {
      omnilog.error(err);
      throw new Error('Failed to write keystore to file');
    }
  }
}

export { BaseCredentialStore, LocalFileCredentialStore };
