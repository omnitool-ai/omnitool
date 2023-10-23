/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IManager, Service, type IServiceConfig } from 'omni-shared';
import axios from 'axios';

interface AuthServiceConfig extends IServiceConfig {
  id: string;
  host: string;
  authUrl: string;
  logoutUrl: string;
  userUrl: string;
  signupUrl: string;
}

class AuthService extends Service {
  constructor(id: string, manager: IManager, config: AuthServiceConfig) {
    super(id, manager, config || { id });
  }

  async login(username?: string, password?: string) {
    const serviceConfig = this.config as AuthServiceConfig;
    if (!username || !password) {
      return null;
    }

    try {
      const response = await axios.post(
        serviceConfig.host + serviceConfig.authUrl,
        {
          username,
          password
        },
        { withCredentials: true }
      );

      await this.emit('authenticated', response?.data);
      return response?.data;
    } catch (err) {
      //@ts-ignore
      if (err.response.status === 404) {
        throw new Error('Login failed! Unable to connect with authentication service. (Error code 404.)');
      }
      this.error('Failed to connect to auth server ' + err);
      return null;
    }
  }

  async register(username?: string, password?: string) {
    const serviceConfig = this.config as AuthServiceConfig;
    if (!username || !password) {
      return null;
    }

    try {
      const response = await axios.put(
        serviceConfig.host + serviceConfig.signupUrl,
        {
          username,
          password
        },
        { withCredentials: true }
      );

      await this.emit('authenticated', response?.data);
      return response?.data;
    } catch (err) {
      this.error('Failed to connect to auth server ' + err);
      return null;
    }
  }

  async logout() {
    const serviceConfig = this.config as AuthServiceConfig;

    this.debug('Logout URL ', serviceConfig.host + serviceConfig.logoutUrl);
    try {
      await axios.post(serviceConfig.host + serviceConfig.logoutUrl, {}, { withCredentials: true });
      await this.emit('authenticated', null); // TODO: [@shinta-liem] -- should we emit a different event instead?
    } catch (err) {
      this.error('Failed to connect with auth server' + err);
    }
  }

  async getAuthenticatedUser() {
    const serviceConfig = this.config as AuthServiceConfig;
    try {
      const response = await axios.get(serviceConfig.host + serviceConfig.userUrl, { withCredentials: true });
      await this.emit('authenticated', response?.data);
      if (response.data != null) {
        return response?.data;
      } else {
        return null;
      }
    } catch (err) {
      this.error('Failed to connect with auth server' + err);
      return null;
    }
  }

  async tryAutoLogin() {
    const serviceConfig = this.config as AuthServiceConfig;
    try {
      const response = await axios.get(`${serviceConfig.host}/api/v1/auth/autologin`, { withCredentials: true });
      await this.emit('authenticated', response?.data);
      if (response.data != null) {
        return response?.data;
      } else {
        return null;
      }
    } catch (err) {
      this.error('Failed to connect with auth server' + err);
      return null;
    }
  }

  create() {
    this.info(`${this.id} create`);
    return true;
  }

  async load() {
    this.info(`${this.id} load`);
    return true;
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

export { AuthService, type AuthServiceConfig };
