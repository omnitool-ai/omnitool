/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import './styles/main.scss';

import { createClient, AuthService } from 'omni-client-services';
import { OmnitoolClient } from './client';
import { loginComponent, doLogin, isLogin } from './components/Login.js';
import Alpine from 'alpinejs';
import { omnilog } from 'omni-shared';
window.Alpine = Alpine;

const client = (window.client = createClient('vite-frontend', { logger: { level: 11 } }, OmnitoolClient));

// register the authentication service
client.use(
  AuthService,
  {
    id: 'auth',
    host: '',
    authUrl: '/api/v1/auth/login',
    logoutUrl: '/api/v1/auth/logout',
    userUrl: '/api/v1/auth/user'
  },
  'service'
);

document.addEventListener('alpine:init', () => {
  omnilog.status_start('Alpine Init');
  Alpine.store('toasts', {
    counter: 0,
    list: {},
    isJobRunning: false,
    createToast(message, jobId, type = 'info', timer = 2000) {
      omnilog.info('createToast', message, jobId, type, timer);
      this.list[jobId] = {
        id: this.counter++,
        message,
        type,
        visible: true
      };
      if (timer > 0) {
        setTimeout(() => {
          this.destroyToast(jobId);
        }, timer);
      }
    },
    destroyToast(jobId) {
      if (this.list[jobId]) {
        this.list[jobId].visible = false;
      }
    }
  });

  Alpine.data('login', () => ({
    currentUser: null,
    isSubmitting: false,
    isLogin() {
      return isLogin(this.currentUser);
    },
    loginComponent,
    async tryLogin(payload) {
      const { username, password, newUser } = payload;
      try {
        const user = await doLogin({ username, password, newUser });
        if (user) {
          this.currentUser = user;
        }
      } catch (e) {
        if (this.isSubmitting) {
          Alpine.store('toasts').createToast(e.message, 'login', 'error');
          this.isSubmitting = false;
        }
      }
    },
    async init() {
      // Attempt autoLogin
      await this.tryLogin({ username: null, password: null, newUser: false });
    }
  }));
});
Alpine.start();
