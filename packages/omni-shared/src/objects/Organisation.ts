/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { DBObject, type IDBObjectLink } from './DBObject';

class Organisation extends DBObject {
  static readonly modelName = 'Organisation';
  name: string;
  members: IDBObjectLink[];
  groups: IDBObjectLink[];

  constructor(id: string, name: string) {
    super(id);
    this._id = `${Organisation.modelName}:${this.id}`;
    this.name = name;
    this.members = [];
    this.groups = [];
  }
}

export { Organisation };
