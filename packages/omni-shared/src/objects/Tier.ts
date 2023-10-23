/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { DBObject } from './DBObject';

enum ETierLimitKey {
  CREDIT = 'Credit',
  CONCURRENT_WORKFLOW = 'Concurrent Workflow'
  // TODO: Add limit here
}

enum ETierLimitOp {
  MAX = 'Max',
  MIN = 'Min',
  EQUAL = '=='
}

enum ETierLimitValue {
  UNLIMITED = 'Unlimited'
}

interface ITierLimit {
  key: ETierLimitKey;
  op: ETierLimitOp;
  value: string | number;
}

class Tier extends DBObject {
  static readonly modelName = 'Tier';
  name: string;
  limits: ITierLimit[];

  constructor(id: string, name: string) {
    super(id);
    this._id = `${Tier.modelName}:${this.id}`;
    this.name = name;
    this.limits = [];
  }
}

export { Tier, type ITierLimit, ETierLimitKey, ETierLimitValue, ETierLimitOp };
