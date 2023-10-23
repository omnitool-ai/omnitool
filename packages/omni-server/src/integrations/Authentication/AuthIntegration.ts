/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// Authentication API integration
//
//  Purpose:  Provides the APIs for authentication
//
//  Usage: This inherits from APIIntegration which can do the heavy lifting of registering routes
//         and proxying APIS. See .mercs.(local.)yaml for how to do that
//
// ---------------------------------------------------------------------------------------------

import { type IntegrationsManager, EObjectAction, Group, Organisation, User, Workflow, omnilog } from 'omni-shared';
import { APIIntegration, type IAPIIntegrationConfig } from '../APIIntegration.js';
import {
  createGetAuthenticatedUserHandler,
  createLoginHandler,
  createLogoutHandler,
  createGenerateTokenHandler,
  createAcceptTOSHandler
} from './handlers/user.js';
import { type DBService } from '../../services/DBService.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  validateCredit,
  validateEmail,
  validateName,
  validatePassword,
  validateStatus,
  validateTier
} from '../../helper/validation.js';
import { generateId, hashPassword } from '../../helper/utils.js';
import { oauth2CallbackHandler, oauth2Handler } from './handlers/oauth2.js';
import { type FastifyRequest } from 'fastify';
import { getGroupByMemberId, loadUserPermission } from '../../helper/permission.js';
import { type IKVStorageConfig } from '../../core/KVStorage.js';

interface IAuthIntegrationConfig extends IAPIIntegrationConfig {
  jwt: {
    secret: string;
  };
  kvStorage: IKVStorageConfig;
}

class AuthIntegration extends APIIntegration {
  db: DBService;

  constructor(id: string, manager: IntegrationsManager, config: IAuthIntegrationConfig) {
    super(id, manager, config || {});
    this.db = manager.app.services.get('db') as DBService;
  }

  get serviceConfig(): IAuthIntegrationConfig {
    return this.config as IAuthIntegrationConfig;
  }

  async load() {
    this.handlers.set('login', createLoginHandler);
    this.handlers.set('logout', createLogoutHandler);
    this.handlers.set('getAuthenticatedUser', createGetAuthenticatedUserHandler);
    this.handlers.set('generateToken', createGenerateTokenHandler);

    this.handlers.set('oauth2', oauth2Handler);
    this.handlers.set('oauth2Callback', oauth2CallbackHandler);
    this.handlers.set('acceptTos', createAcceptTOSHandler);

    return await super.load();
  }

  /**
   * When a user logs in the system would:
   * - load the user permissions
   * - load the user settings
   *
   * @param user
   */
  async login(request: FastifyRequest) {
    const user = request.user as User;
    const ability = await loadUserPermission(this.db, user);
    // @ts-ignore
    request.session.set('permission', ability);

    omnilog.debug('Login user', user.id, request.session.sessionId, ability);
  }

  async isAdmin(user: User): Promise<boolean> {
    const groups = await getGroupByMemberId(this.db, user.id);
    for (const group of groups) {
      if (group.name.toLowerCase() === 'admin') {
        return true;
      }
    }

    return false;
  }

  validateRequestParameters(params: any) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { username, password, email, status, credit, groups } = params;

    const error = [];
    if (username && !validateName(username)) {
      this.error('Invalid username');
      error.push('Invalid username');
    }

    if (password && !validatePassword(password)) {
      this.error('Invalid password');
      error.push('Invalid password');
    }

    if (email && !validateEmail(email)) {
      this.error('Invalid email');
      error.push('Invalid email');
    }

    if (status && !validateStatus(status)) {
      this.error('Invalid status');
      error.push('Invalid status');
    }

    if (credit && !validateCredit(credit)) {
      this.error('Invalid credit');
      error.push('Invalid credit');
    }

    return error;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    try {
      const query = {
        username: username.toLowerCase()
      };
      const result = await this.db.find(query);
      if (result && result.length > 0) {
        return result[0];
      } else {
        return null;
      }
    } catch (err) {
      this.error(err);
      throw err;
    }
  }

  async handleRegister(username: string, password: string, tier?: any): Promise<User> {
    const validationErrors = this.validateRequestParameters({ username, password });

    if (!username || !password || validationErrors.length > 0) {
      throw new Error('Invalid request parameters ' + validationErrors.join(', '));
    }
    if (tier && !(await validateTier(this.db, tier))) {
      throw new Error('Invalid tier');
    }

    try {
      const user = await this.getUserByUsername(username);
      if (user == null) {
        return await this.createUser(username, password, tier);
      } else {
        throw new Error('Unauthorized access');
      }
    } catch (err) {
      this.error(err);
      throw err;
    }
  }

  async generateJwtToken(scopes: any, issuer: User, expiresIn: number = 3600) {
    this.debug('Generating token with scopes: ', scopes);
    try {
      // @ts-ignore
      const config = this.config as IAuthIntegrationConfig;

      if (config.jwt.secret) {
        // Generate JWT token
        const token = jwt.sign(
          {
            scopes,
            issuerId: issuer?.id || '',
            tokenId: generateId()
          },
          config.jwt.secret,
          { expiresIn }
        );

        return token;
      } else {
        throw new Error('JWT secret not configured');
      }
    } catch (err) {
      this.error(err);
      throw err;
    }
  }

  private async createUser(username: string, password: string, tier?: any): Promise<User> {
    const salt = crypto.randomBytes(16);
    const hashedPassword = hashPassword(password, salt);

    // TODO : We automatically create an org and admin group for users on free tier
    // For enterprise tier user, Org and group should be created first before members are provisioned

    // Create organization
    const newOrg = new Organisation(generateId(), `Org-${generateId()}`);
    newOrg.createdAt = Math.floor(Date.now() / 1000);
    newOrg.lastUpdated = Math.floor(Date.now() / 1000);

    // Create admin group
    const newGroup = new Group(generateId(), 'Admin');
    newGroup.createdAt = Math.floor(Date.now() / 1000);
    newGroup.lastUpdated = Math.floor(Date.now() / 1000);
    newGroup.organisation = { id: newOrg.id, name: newOrg.name };
    newGroup.permission = [
      // Admin rights: r/w users from the same org
      {
        subject: User.modelName,
        action: [EObjectAction.CREATE, EObjectAction.READ, EObjectAction.UPDATE, EObjectAction.DELETE],
        conditions: [{ organisation: { id: newOrg.id } }]
      },
      // Admin rights: r/w groups from the same org
      {
        subject: Group.modelName,
        action: [EObjectAction.CREATE, EObjectAction.READ, EObjectAction.UPDATE, EObjectAction.DELETE],
        conditions: [{ organisation: { id: newOrg.id } }]
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
        conditions: [{ org: { id: newOrg.id } }]
      }
    ];

    const newUser = new User(generateId(), username.toLowerCase());
    newUser.password = hashedPassword.toString('hex');
    newUser.salt = salt.toString('hex');
    newUser.tier = tier;
    newUser.organisation = { id: newOrg.id, name: newOrg.name };
    newUser.createdAt = Math.floor(Date.now() / 1000);
    newUser.lastUpdated = Math.floor(Date.now() / 1000);
    // TODO: Add more info on sign up
    await this.db.put(newUser);

    newOrg.members = [{ id: newUser.id, name: newUser.username }];
    newOrg.groups = [{ id: newGroup.id, name: newGroup.name }];
    await this.db.put(newOrg);

    newGroup.members = [{ id: newUser.id, name: newUser.username }];
    await this.db.put(newGroup);

    return newUser;
  }
}

export { AuthIntegration, type IAuthIntegrationConfig };
