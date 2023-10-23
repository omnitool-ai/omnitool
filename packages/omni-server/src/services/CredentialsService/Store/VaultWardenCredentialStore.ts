/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { BaseCredentialStore } from './BaseCredentialStore.js';
import axios from 'axios';
import { randomUUID } from 'crypto';

interface IVaultWardenCredentialStoreConfig {
  tokenUrl: string;
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  vaultOrgId: string;
  vaultCollectionId: string;
}

class VaultWardenCredentialStore extends BaseCredentialStore {
  private _accessToken?: string | null;
  private readonly _config: IVaultWardenCredentialStoreConfig;

  constructor(config: IVaultWardenCredentialStoreConfig) {
    super();
    this._config = config;
  }

  async init(): Promise<void> {
    await this.getAccessToken();
  }

  async getSecret(vaultKey: string): Promise<string> {
    const requestConfig = {
      headers: {
        Authorization: `Bearer ${this._accessToken}`
      }
    };

    try {
      const response = await axios.get(`${this._config.apiUrl}/ciphers/${vaultKey}`, requestConfig);
      if (response.status === 200) {
        return JSON.parse(response.data.Data.Notes);
      } else {
        omnilog.error('Failed getting ciphers:', response.status);
        throw new Error('Failed getting ciphers');
      }
    } catch (error) {
      omnilog.error('Error getting ciphers:', error);
      throw new Error('Error getting ciphers');
    }
  }

  async setSecret(secret: string): Promise<boolean> {
    const requestConfig = {
      headers: {
        Authorization: `Bearer ${this._accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    const requestData = {
      cipher: {
        organizationId: this._config.vaultOrgId,
        type: 2, // 2 for Secure Note type
        name: 'secret',
        notes: secret,
        secureNote: {
          type: 0 // 0 for Generic type
        }
      },
      collectionIds: [this._config.vaultCollectionId]
    };

    try {
      const response = await axios.post(`${this._config.apiUrl}/ciphers/create`, requestData, requestConfig);
      if (response.status === 200) {
        omnilog.info('Secure note created successfully');
        return response.data.Id;
      } else {
        omnilog.error('Failed to create secure note:', response.status);
        throw new Error('Failed to create secure note');
      }
    } catch (error) {
      omnilog.error('Error creating secure note');
      throw new Error('Error creating secure note');
    }
  }

  async deleteSecret(vaultKey: string): Promise<boolean> {
    const requestConfig = {
      headers: {
        Authorization: `Bearer ${this._accessToken}`
      }
    };

    try {
      omnilog.debug('Revoking cipher:', requestConfig);
      const response = await axios.delete(`${this._config.apiUrl}/ciphers/${vaultKey}`, requestConfig);
      if (response.status === 200) {
        return true;
      } else {
        omnilog.error('Failed revoking cipher:', response.status);
        throw new Error('Failed revoking ciphers');
      }
    } catch (error) {
      omnilog.error('Error revoking ciphers', error);
      throw new Error('Error revoking ciphers');
    }
  }

  private async getAccessToken(): Promise<void> {
    try {
      omnilog.debug('Getting access token...');
      const response = await axios.post(
        this._config.tokenUrl,
        {
          grant_type: 'client_credentials',
          client_id: this._config.clientId,
          client_secret: this._config.clientSecret,
          scope: 'api',
          device_type: 14,
          device_identifier: randomUUID(),
          device_name: 'mercs'
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.status === 200) {
        this._accessToken = response.data.access_token;
        this.scheduleTokenRefresh(response.data.expires_in);
      } else {
        omnilog.error('Failed to get access token:', response.status);
        this._accessToken = null;
      }
    } catch (error) {
      omnilog.error('Error getting access token');
      this._accessToken = null;
    }
  }

  private scheduleTokenRefresh(expiresIn: number): void {
    // Refresh the token slightly earlier than the actual expiration time
    const refreshTime = (expiresIn - 60) * 1000; // expiresIn is in seconds, convert to milliseconds and subtract 60 seconds

    setTimeout(() => {
      omnilog.log('Refreshing access token...');
      this.getAccessToken();
    }, refreshTime);
  }
}

export { type IVaultWardenCredentialStoreConfig, VaultWardenCredentialStore };
