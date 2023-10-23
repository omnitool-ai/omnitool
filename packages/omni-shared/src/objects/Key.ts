/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { DBObject, type IDBObjectLink } from './DBObject';

interface IAPIKeyMetaData {
  name: string;
  description: string;
  revoked: boolean;
  // @deprecated
  owner: IDBObjectLink;
}

class APIKey extends DBObject {
  static readonly modelName = 'APIKey';

  meta: IAPIKeyMetaData;
  apiNamespace: string;
  variableName: string;
  vaultType: string; // Type of vault used to store the key: local, vaultwarden, etc
  key: string; // ID mapping to the actual key in the keystore
  owner: string; // _id of the owner

  constructor(id: string) {
    super(id);
    this._id = `${APIKey.modelName}:${this.id}`;
    this.meta = {
      name: '',
      description: '',
      owner: {
        id: '',
        type: '',
        name: ''
      },
      revoked: false
    };
    this.key = '';
    this.vaultType = 'local';
    this.owner = '';
    this.apiNamespace = '';
    this.variableName = '';
  }
}

export { APIKey, type IAPIKeyMetaData };
