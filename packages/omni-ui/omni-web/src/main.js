/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import './styles/main.scss';

import {
  createClient,
  AuthService,
  CommandService,
  MessagingClientService,
  JobControllerClientService,
  ChatClientService
} from 'omni-client-services';
import { OmnitoolClient } from './client';

import Alpine from 'alpinejs';
import intersect from '@alpinejs/intersect';
import focus from '@alpinejs/focus';
import { registerUtils } from './components/Utils.js';
import { doLogin, isLogin } from './components/Login.js';
import { chatComponent } from './components/ChatWindow.js';

import { workflowEditorComponent } from './components/WorkflowEditor.js';
import { OmniLogLevels, registerOmnilogGlobal } from 'omni-shared';
import axios from 'axios';

const urlParams = new URLSearchParams(window.location.search);
const mFlag = urlParams.get('m'); // Returns "value1"
const isMobile = (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || mFlag === 'm') && mFlag !== 'ds';

registerOmnilogGlobal();

// global log level
omnilog.wrapConsoleLogger();
omnilog.level = OmniLogLevels.debug;
omnilog.setCustomLevel('emittery', OmniLogLevels.silent);

window.Alpine = Alpine;
Alpine.plugin(intersect);
Alpine.plugin(focus);

const jobStorage = Alpine.reactive({});

const chatState = Alpine.reactive({
  inputText: '',
  messages: [],
  recognition: null,
  recognitionAvailable: false,
  recognitionRecording: false
});

const hideEditor = Alpine.reactive({ isMobile });

const connectionState = Alpine.reactive({
  isConnected: false,
  showDisconnectModal: false,
  reason: ''
});

const tosState = Alpine.reactive({ hasTOS: false });

// --------------------------------------------------------------------------------------------------
// Connect to the omni tool SDK
// --------------------------------------------------------------------------------------------------
const client = (window.client = createClient('vite-frontend', {}, OmnitoolClient));

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

// register the messaging service
client.use(MessagingClientService, { id: 'messaging' }, 'service');
// register the chat service
client.use(ChatClientService, { id: 'chat', initialState: chatState, workbench: client.workbench }, 'service');
// register the job control system
client.use(JobControllerClientService, { id: 'jobs', jobStorage }, 'service');
// register the scriptable command system
client.use(CommandService, { id: 'command' }, 'service');

const chatContainer = document.querySelector('#chat');
const sidebar = document.querySelector('#sidebar');

const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    document.documentElement.style.setProperty('--chat-width', `${entry.contentRect.width}px`);
    document.documentElement.style.setProperty(
      '--editor-width',
      `${window.innerWidth - sidebar.offsetWidth - 10 - entry.contentRect.width}px`
    );
    document.documentElement.style.setProperty('--sidebar-width', `${sidebar.offsetWidth}px`);
  }
});
resizeObserver.observe(chatContainer);

const documentSize = () => {
  document.documentElement.style.setProperty('--doc-height', `${window.innerHeight}px`);
  document.documentElement.style.setProperty('--doc-width', `${window.innerWidth}px`);
  document.documentElement.style.setProperty('--chat-width', `${chatContainer.offsetWidth}px`);
  document.documentElement.style.setProperty(
    '--editor-width',
    `${window.innerWidth - sidebar.offsetWidth - 10 - chatContainer.offsetWidth}px`
  );
};

const resizeHandler = () => {
  documentSize();
  void client.emit('request_editor_resize');
};
window.addEventListener('resize', resizeHandler);

document.addEventListener('alpine:init', () => {
  omnilog.status_start('Alpine init');

  Alpine.data('auth', () => ({
    currentUser: undefined,
    isLogin() {
      return isLogin(this.currentUser);
    },
    isTOS() {
      return tosState.hasTOS;
    },
    onAcceptTOS() {
      void axios
        .post('/api/v1/auth/accepttos', {
          accept: true
        })
        .then((response) => {
          if (Number.parseInt(response.data.tosAccepted) > 0) {
            omnilog.info('Verified acceptance of TOS ' + response.data.tosAccepted);
            tosState.hasTOS = true;
          }
        })
        .catch((error) => {
          omnilog.error(error);
        });
    },
    async init() {
      try {
        this.currentUser = await doLogin({ username: null, password: null });
        tosState.hasTOS = this.currentUser.tosAccepted > 0;
      } catch (e) {
        omnilog.error(e.messages);
      }
    }
  }));

  // ------------------------------------------------------------------
  // Central AppState Object
  // ------------------------------------------------------------------
  Alpine.data('appState', () => ({
    showAdmin: false,
    showUsers: false,
    connectionState,
    tosState,
    hideEditor,
    workbench: client.workbench,
    chatComponent,
    workflowEditor: workflowEditorComponent('editor', client.workbench),
    uiSettings: client.uiSettings,
    async init() {
      this.$watch('tosState', () => {
        omnilog.log('TOS changed ' + tosState.hasTOS);
        if (tosState.hasTOS) {
          void this.boot();
        }
      });
      client.subscribeToServiceEvent('auth', 'authenticated', async (user) => {
        if (tosState.hasTOS) {
          void this.boot();
        }
      });
    },
    async boot() {
      client.subscribeToServiceEvent('messaging', 'connected', async () => {
        connectionState.isConnected = true;
        connectionState.showDisconnectModal = false;
        connectionState.reason = '';
      });
      client.subscribeToServiceEvent('messaging', 'disconnected', async ({ fatal, reason }) => {
        connectionState.isConnected = false;
        connectionState.showDisconnectModal = fatal;
        connectionState.reason = reason;
      });
      // initialize the client which will load extensions from the server
      await client.init();
      // load the client
      await client.load();
      // start the client
      await client.start();
      // start the workflow editor
      await this.workflowEditor.start();

      omnilog.status_start('Appstate Init');
      window.dispatchEvent(new Event('resize'));
    }
  }));

  registerUtils(Alpine);
});
Alpine.start();
