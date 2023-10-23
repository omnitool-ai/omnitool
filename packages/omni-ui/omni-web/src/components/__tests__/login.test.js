/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { isLogin } from '../Login.js';

describe('login', () => {
  it('should return false if user is not logged in', () => {
    expect(isLogin(null)).toBe(false);
    expect(isLogin('')).toBe(false);
    expect(isLogin(undefined)).toBe(false);
    expect(isLogin({})).toBe(false);
  });
});
