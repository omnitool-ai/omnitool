/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import type * as Nano from 'nano';

interface IDBObject {
  _id?: string;
  _rev?: string;
}

interface IDBObjectLink {
  id: string;
  type?: string;
  name: string;
}

abstract class DBObject implements IDBObject {
  _id?: string;
  _rev?: string;
  id: string;
  createdAt: number;
  lastUpdated: number;

  constructor(id: string) {
    this._rev = undefined;
    this.id = id;
    this.createdAt = Date.now();
    this.lastUpdated = Date.now();
  }

  processAPIResponse(response: Nano.DocumentInsertResponse) {
    if (response.ok) {
      this._id = response.id;
      this._rev = response.rev;
    }
  }
}

export { type IDBObject, type IDBObjectLink, DBObject };
