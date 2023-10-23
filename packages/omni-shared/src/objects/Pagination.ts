/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IDBObject } from './DBObject';

interface IPaginatedObject {
  bookmark?: string;
  data: IDBObject[];
  page: number | undefined;
  docsPerPage: number | undefined;
  totalDocs: number | undefined;
  totalPages: number | undefined;
}

function CreatePaginatedObject(): IPaginatedObject {
  return { data: [], page: undefined, docsPerPage: undefined, totalDocs: undefined, totalPages: undefined };
}

export { type IPaginatedObject, CreatePaginatedObject };
