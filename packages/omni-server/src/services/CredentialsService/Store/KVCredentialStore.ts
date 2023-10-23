/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { KVStorage, type IKVStorageConfig } from '../../../core/KVStorage.js';
import { BaseCredentialStore } from './BaseCredentialStore.js';
import { type CredentialService } from '../CredentialService.js';

interface IKVKey {
  secret: string;
}

class KVCredentialStore extends BaseCredentialStore {
  private readonly _vault: KVStorage;

  constructor(parent: CredentialService, config: IKVStorageConfig) {
    super();
    this._vault = new KVStorage(parent, config);
  }

  async init(): Promise<void> {
    if (!(await this._vault.init())) {
      throw new Error('KVStorage failed to start');
    }
    await this._vault.vacuum();
  }

  getSecret(vaultKey: string): string | undefined {
    const json = this._vault.get(`cred.${vaultKey}`) as IKVKey;
    if (json) {
      return json.secret;
    }
  }

  async setSecret(secret: string, vaultKey?: string): Promise<boolean> {
    if (vaultKey) {
      this._vault.set(`cred.${vaultKey}`, { secret });
      return true;
    }

    throw new Error('Vault key is required');
  }

  deleteSecret(vaultKey: string): boolean {
    this._vault.del(`cred.${vaultKey}`);
    return true;
  }
}

export { KVCredentialStore };
