/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { Tier } from 'omni-shared';
import { type DBService } from '../services/DBService';
import { stat as fsStat } from 'fs/promises';

const validateName = function (username: string) {
  omnilog.log('Testing', username);
  return /^[a-z0-9]+$/.test(username);
};

const validateEmail = function (email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const validateStatus = function (status: string) {
  return status === 'active' || status === 'inactive';
};

const validatePassword = function (password: string) {
  // const hasUppercase = /[A-Z]/.test(password)
  // const hasLowercase = /[a-z]/.test(password)
  // const hasNumber = /\d/.test(password)
  // const hasSymbol = /[-!$%^&*()_+|~=`{}\[\]:";'<>?,.\/]/.test(password)
  // return (password.length >= 8) && hasUppercase && hasLowercase && hasNumber && hasSymbol;
  // Only validate length for now
  return password.length >= 8;
};

const validateCredit = function (credit: number) {
  return credit >= 0;
};

const validateTier = async function (db: DBService, tierId: string): Promise<Tier | null> {
  const tier = (await db.get(`${Tier.name}:${tierId}`)) as Tier;
  return tier;
};

const validateMembers = async function (db: DBService, members: Array<{ id: string }>): Promise<any> {
  const errors: string[] = [];
  const validMembers: Array<{ id: string }> = [];
  if (!members) {
    return { validMembers, errors };
  }

  for (const member of members) {
    const user = await db.get(`user:${member.id}`);
    if (user == null) {
      errors.push(`User ${member.id} does not exist`);
    } else {
      validMembers.push(member);
    }
  }

  return { validMembers, errors };
};

async function validateDirectoryExists(path: string) {
  try {
    const stats = await fsStat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function validateFileExists(path: string) {
  try {
    const stats = await fsStat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

export {
  validateName,
  validateCredit,
  validateMembers,
  validatePassword,
  validateEmail,
  validateStatus,
  validateTier,
  validateDirectoryExists,
  validateFileExists
};
