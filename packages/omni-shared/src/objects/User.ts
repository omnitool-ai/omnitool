/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { omnilog } from '../core/OmniLog';
import { Settings } from '../core/Settings';
import { DBObject, type IDBObjectLink } from './DBObject';

enum EUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive'
}

class User extends DBObject {
  static readonly modelName = 'User';

  email: string | null;
  username: string;
  status: string;
  externalId: string | undefined;
  authType: string | undefined;
  credit: number;
  organisation: IDBObjectLink | null;
  tier: IDBObjectLink | null;

  password: string | null;
  salt: string | null;
  tags: string[];

  settings: Settings;

  tosAccepted: number;

  constructor(id: string, username: string) {
    super(id);
    this._id = `user:${this.id}`;
    this.email = null;
    this.username = username;
    this.status = EUserStatus.ACTIVE;
    this.credit = 0;
    this.organisation = null;
    this.tier = null;
    this.password = null;
    this.salt = null;
    this.tags = [];
    this.settings = new Settings(this.id);
    this.tosAccepted = 0;
  }

  // @deprecated
  isAdmin() {
    // Moving this to AuthIntegration to optimize db calls
    omnilog.warn('User.isAdmin() is deprecated. Use AuthIntegration.isAdmin() instead');
    return this.tags.some((tag) => tag === 'admin');
  }

  static fromJSON(json: any): User {
    const result = new User(json.id, json.username);
    result._id = json._id;
    result._rev = json._rev;
    result.id = json.id;
    result.createdAt = json.createdAt;
    result.lastUpdated = json.lastUpdated;
    result.email = json.email;
    result.username = json.username;
    result.status = json.status;
    result.externalId = json.externalId;
    result.authType = json.authType;
    result.credit = json.credit;
    result.organisation = json.organisation;
    result.tier = json.tier;
    result.password = json.password;
    result.salt = json.salt;
    result.tags = json.tags;
    result.tosAccepted = json.tosAccepted;
    return result;
  }
}

export { User, EUserStatus };
