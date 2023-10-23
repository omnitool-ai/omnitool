/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { DBObject, type IDBObjectLink } from './DBObject';

enum EObjectName {
  USER = 'User',
  GROUP = 'Group',
  ORGANISATION = 'Organisation',
  WORKFLOW = 'Workflow'
}

enum EObjectAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  EXECUTE = 'exec'
}

interface IGroupPermission {
  subject: any;
  action: string[];
  conditions?: any;
}

class Group extends DBObject {
  name: string;
  credit: number;
  organisation: IDBObjectLink | null;
  members: IDBObjectLink[];
  permission: IGroupPermission[];

  static readonly modelName = 'Group';

  constructor(id: string, name: string) {
    super(id);
    this._id = `${Group.modelName}:${this.id}`;
    this.name = name;
    this.credit = 0;
    this.organisation = null;
    this.members = [];
    this.permission = [];
  }
}

export { Group, type IGroupPermission, EObjectName, EObjectAction };
