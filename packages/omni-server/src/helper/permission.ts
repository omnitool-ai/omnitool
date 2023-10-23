/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type PureAbility, type Subject, defineAbility } from '@casl/ability';
import { Group, type User, EObjectAction, EObjectName } from 'omni-shared';
import { OMNITOOL_DOCUMENT_TYPES, type DBService } from '../services/DBService.js';
import { performance } from 'perf_hooks';
import assert from 'node:assert';

async function getGroupByMemberId(db: DBService, userId: string): Promise<Group[]> {
  const start = performance.now();
  const query = {
    _id: {
      $gte: `${Group.name}:`, // i.e. _id.startswith(userId + ':')
      $lt: `${Group.name}:\u10FFFF`
    },
    members: {
      $elemMatch: {
        id: userId
      }
    }
  };

  try {
    const result = (await db.find(query)) || [];
    const end = performance.now();
    omnilog.trace(`getGroupByMemberId(${userId}) took ${(end - start).toFixed()} ms`);
    return result;
  } catch (err) {
    const end = performance.now();
    omnilog.info(`getGroupByMemberId(${userId}) returned an error in ${(end - start).toFixed()} ms`);
    db.error(err);
    return [];
  }
}

async function setAcceptedTOS(db: DBService, user: User): Promise<number> {
  try {
    user.tosAccepted = Date.now();
    assert(user._id != null, 'User ID is null');
    //await db.put(JSON.parse(JSON.stringify(user)));
    const dbuserobj = await db.getDocumentById(OMNITOOL_DOCUMENT_TYPES.USER, user.id, [], false);
    // @ts-ignore
    dbuserobj.tosAccepted = user.tosAccepted;
    await db.putDocumentById(OMNITOOL_DOCUMENT_TYPES.USER, user.id, dbuserobj);
    return user.tosAccepted;
  } catch (err) {
    db.error(err);
    return 0;
  }
}

const loadUserPermission = async function (db: DBService, user: User) {
  const start = performance.now();
  const groups = await getGroupByMemberId(db, user.id);
  const groupIds = groups.map((group) => group.id);
  const permissions = groups.map((group) => group.permission).flat();

  // Add sharing permissions
  // @ts-ignore
  permissions.push(
    // User can edit their own details
    {
      action: [EObjectAction.READ, EObjectAction.UPDATE],
      subject: EObjectName.USER,
      conditions: { id: user.id }
    }
  );
  permissions.push(
    // Allow user to read workflows that are shared with them
    {
      action: [EObjectAction.READ],
      subject: EObjectName.WORKFLOW,
      conditions: { sharedWith: { $elemMatch: { id: user.id } } }
    }
  );

  permissions.push(
    // Allow user to read workflows that are shared with their team
    {
      action: [EObjectAction.READ],
      subject: EObjectName.WORKFLOW,
      conditions: { sharedWith: { $elemMatch: { id: { $in: groupIds.map((id) => id) } } } }
    }
  );
  // Allow user to read workflows that are shared with their organisation
  if (user.organisation != null && user.organisation.id) {
    permissions.push({
      action: [EObjectAction.READ],
      subject: EObjectName.WORKFLOW,
      conditions: { sharedWith: { $elemMatch: { id: user.organisation?.id } } }
    });
  }
  // Allow user to update, delete workflows that are owned by them
  permissions.push({
    action: [EObjectAction.UPDATE, EObjectAction.DELETE],
    subject: EObjectName.WORKFLOW,
    conditions: { owner: user.id }
  });

  permissions.push({
    subject: EObjectName.WORKFLOW,
    action: [EObjectAction.CREATE, EObjectAction.READ, EObjectAction.EXECUTE],
    conditions: [{ meta: { organisation: { id: user.organisation?.id } } }, { org: { id: user.organisation?.id } }]
  });

  permissions.filter((rule) => rule !== null);

  const end = performance.now();
  omnilog.info(`loadPermission took ${(end - start).toFixed()} ms`);
  return permissions;
};

const loadAbilityByTokenScope = async function (scopes: any[]) {
  const ability = defineAbility((allow, forbid) => {
    for (const s of scopes) {
      const { action, subject, orgId, workflowIds } = s;
      if (subject === EObjectName.USER) {
        // If the action is on user object, it will be limited to specific org ID
        allow(action, subject, { organisation: { id: orgId } });
      } else if (subject === EObjectName.WORKFLOW) {
        // If the action is on workflow object, it will be limited to the specified workflow ID
        allow(action, subject, { id: { $in: workflowIds } });
      }
    }
  });

  return ability;
};

class PermissionChecker {
  private readonly _ability: PureAbility;
  constructor(rules: any) {
    omnilog.debug('User permission ', rules);
    this._ability = defineAbility((allow, forbid) => {
      for (const rule of rules) {
        const fields = undefined; // Workaround aliasing bug in @casl/ability. Do not remove!
        allow(rule.action, rule.subject, fields, rule.conditions);
      }
    });
  }

  can(action: string, subject: Subject, field?: string) {
    return this._ability.can(action, subject, field);
  }
}

export { loadUserPermission, loadAbilityByTokenScope, getGroupByMemberId, PermissionChecker, setAcceptedTOS };
