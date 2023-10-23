/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type DocumentScope } from 'nano';
import { v4 as uuidv4 } from 'uuid';
import { omnilog } from './OmniLog.js';

type UUID = string;
type UserID = UUID;
type OrgID = UUID;

interface Meta {
  name: string;
  description: string;
  created: Date;
  updated: Date;
  tags: string[];
}

interface ICollectionItem {
  type: string;
  id: string;
  value: any; // TODO: Can this be a specific type or a union of types?
}

interface IPageResult {
  page: Array<ICollectionItem>;
  skipped: number;
  remaining: number;
  currBookmark: string;
  nextBookmark: string;
  prevBookmark: string;
}

class Collection {
  _id: UUID; // CouchDB ID needs a leading underscore
  items: Array<ICollectionItem>;
  meta: Meta | null;
  creator: UserID;
  owner: UserID;
  org: OrgID;

  // Creation
  constructor(creator: UserID, owner: UserID, org: OrgID, meta: Meta | null) {
    this._id = uuidv4();
    this.items = [];
    this.creator = creator;
    this.owner = owner;
    this.org = org;
    this.meta = meta;
  }

  // Size of the collection
  getSize(): number {
    return this.items.length;
  }

  // Convert the Collection object to a JSON string
  toJSON(): string {
    return JSON.stringify(this);
  }

  // Convert a JSON string to a Collection object
  static fromJSON(json: string): Collection | null {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.items)) {
        omnilog.error('Invalid items data');
        return null;
      }
      const collection = new Collection(data.creator, data.owner, data.org, data.meta);
      collection.items = data.items;
      collection._id = data._id;
      return collection;
    } catch (e) {
      omnilog.error('Error parsing JSON', e);
      return null;
    }
  }

  add(item: ICollectionItem | Array<ICollectionItem>) {
    if (!Array.isArray(item)) {
      item = [item]; // convert item to array
    }

    // Remove any existing items with the same ids
    this.remove(item.map((i) => i.id));

    // Add the new items
    this.items.push(...item);
  }

  remove(id: string | Array<string>) {
    if (!Array.isArray(id)) {
      id = [id]; // convert id to array
    }

    this.items = this.items.filter((item) => !id.includes(item.id)); // Assume unique id ...
  }

  // Database access, save
  async saveToDB(db: DocumentScope<unknown>) {
    try {
      const response = await db.insert(this);
      omnilog.log('Saved to DB', response);
    } catch (err) {
      omnilog.error('Error saving to DB', err);
    }
  }

  // Database access, load
  static async loadFromDB(db: DocumentScope<object>, id: UUID): Promise<Collection | null> {
    try {
      const doc: any = await db.get(id);
      const collection = Collection.fromJSON(JSON.stringify(doc));
      if (!collection) {
        // Error loading from DB: Invalid document data
        return null;
      }
      return collection;
    } catch (err) {
      // Error loading from DB: Document not found
      return null;
    }
  }

  //Pagination
  getPage(pageSize: number, bookmark: string): IPageResult {
    let startIndex = 0;

    if (bookmark) {
      const bookmarkIndex = this.items.findIndex((item) => item.id === bookmark);
      if (bookmarkIndex === -1) {
        throw new Error(`Bookmark id not found: ${bookmark}`); // !!
      }
      startIndex = bookmarkIndex; // start from the bookmark
    }

    const page = this.items.slice(startIndex, startIndex + pageSize);
    const prevBookmark = startIndex > pageSize ? this.items[startIndex - pageSize]?.id : '';
    const nextBookmark = startIndex + pageSize < this.items.length ? this.items[startIndex + pageSize]?.id : '';
    const currBookmark = this.items[startIndex]?.id || '';
    const skipped = startIndex;
    const remaining = Math.max(this.items.length - (startIndex + pageSize), 0);

    return {
      page,
      skipped,
      remaining,
      currBookmark,
      nextBookmark,
      prevBookmark
    };
  }
}

export { Collection, type ICollectionItem };
