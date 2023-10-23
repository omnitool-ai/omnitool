/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// Mercenaries default API integration
//
//  Purpose:  Provides a default API integration for Mercenaries functions
//
//  Usage: This inherits from APIIntegration which can do the heavy lifting of registering routes
//         and proxying APIS. See .mercs.(local.)yaml for how to do that
//
// ---------------------------------------------------------------------------------------------

import { type User, type IApp, type IIntegration, type Integration, type IntegrationsManager } from 'omni-shared';
import { APIIntegration, type IAPIIntegrationConfig } from '../APIIntegration.js';
import { createPingHandler, pingClientExport } from './handlers/ping.js';
// import { createFileUploadHandler } from './handlers/upload.js'
import type MercsServer from '../../core/Server.js';
import { createFetchExport, createFetchHandler } from './handlers/fetch.js';
import { createIntegrationsHandler } from './handlers/integrations.js';
import { createRunScriptHandler, runScriptClientExport } from './handlers/runscript.js';
import { createListenHandler } from './handlers/sse.js';

import { type FastifyRequest } from 'fastify';
import { addEditPatchComponentClientExport } from './handlers/component.js';
import { getComponentsClientExport, getComponentsHandler } from './handlers/components.js';
import {
  createGetRequiredKeysHandler,
  createListUserKeysHandler,
  createRevokeUserKeyHandler,
  createSetUserKeyHandler,
  bulkSetUserKeysHandler
} from './handlers/credentials.js';
import { createGetExtensionHandler } from './handlers/extensions.js';

import { stat } from 'fs/promises';
import { type WorkerContext } from 'omni-sockets';
import sanitize from 'sanitize-filename';
import { PermissionChecker, loadUserPermission } from '../../helper/permission.js';
import { type DBService } from '../../services/DBService.js';

interface IRunScriptContext {
  user?: any;
  userId?: string;
  session?: any;
  sessionId?: string;
  integration: IIntegration;
  app: IApp;
  request?: FastifyRequest;
  getData: () => Function;
}

interface MercsDefaultIntegrationConfig extends IAPIIntegrationConfig {}

// TODO: [security] - Validate disable for prod
// dynamically load a script and run it.

const runScript = async function (
  integration: Integration,
  context: FastifyRequest | WorkerContext,
  scriptName: string,
  payload: any,
  opts?: any
) {
  let extension;

  if (scriptName.includes(':')) {
    let extensionId;
    [extensionId, scriptName] = scriptName.split(':');

    extension = (integration.app as MercsServer).extensions.get(extensionId);

    if (!extension) {
      throw new Error(`Invalid Script ${extensionId}:${scriptName}`);
    }
  }

  scriptName = sanitize(scriptName);

  const fileName = extension ? extension.getScriptFile(scriptName) : `${process.cwd()}/scripts/${scriptName}.js`;
  if (await stat(fileName)) {
    let result = null;
    const modules: any = {};
    try {
      modules.script = (await import(`file://${fileName}?version=${Number(new Date())}`)).default;

      const inputContext = context as any;
      const ctxContent = {
        userId: inputContext.user?.id || inputContext.userId,
        sessionId: inputContext.session?.sessionId || inputContext.sessionId,
        user: inputContext.user,
        session: inputContext.session,
        integration,
        app: integration.app
      };
      const ctx: IRunScriptContext = {
        ...ctxContent,
        getData: (): any => ctxContent
      };
      // if context is not a workflow, add the fastify request
      // @ts-expect-error
      ctx.request = Object.prototype.hasOwnProperty.call(context, 'workflowId') ? undefined : context;

      if (modules.script.permission) {
        integration.info('Checking required permission for script', fileName);
        let userPermission = ctx.session?.get('permission');
        if (!userPermission) {
          integration.info('No permission found in session, trying to load user permission from DB');
          const db = integration.app.services.get('db') as DBService;
          const user = (await db.get(`user:${ctx.userId}`)) as User;
          userPermission = await loadUserPermission(db, user);
        }

        const ability = new PermissionChecker(userPermission);
        await modules.script.permission(ctx, ability, payload);
      }

      integration.info('Invoking server script', fileName);
      result = await modules.script.exec(ctx, payload || {}, opts);
      integration.verbose('runscript result', result);
    } catch (e) {
      // @ts-ignore
      const error = e.message || e;
      integration.error(error);
      throw e;
    } finally {
      delete modules.script;
    }

    return result;
  } else {
    throw new Error(`Script not found: ${fileName}`);
  }
};

class MercsDefaultIntegration extends APIIntegration {
  constructor(id: string, manager: IntegrationsManager, config: MercsDefaultIntegrationConfig) {
    super(id, manager, config || {});
  }

  async load() {
    this.handlers.set('ping', createPingHandler);

    this.handlers.set('getExtensions', createGetExtensionHandler);

    // this.handlers.set('upload', createFileUploadHandler)
    this.handlers.set('fetch', createFetchHandler);
    this.handlers.set('listen', createListenHandler);
    this.handlers.set('integrations', createIntegrationsHandler);
    this.handlers.set('runscript', createRunScriptHandler);
    this.handlers.set('components', getComponentsHandler);

    // this.handlers.set('addEditPatchComponent', addEditPatchComponentHandler)

    // Credentials API
    this.handlers.set('setUserKey', createSetUserKeyHandler);
    this.handlers.set('revokeUserKey', createRevokeUserKeyHandler);
    this.handlers.set('listUserKeys', createListUserKeysHandler);
    this.handlers.set('getRequiredKeys', createGetRequiredKeysHandler);
    this.handlers.set('bulkAddUserKeys', bulkSetUserKeysHandler);

    this.clientExports.set('ping', pingClientExport);
    this.clientExports.set('fetch', createFetchExport);
    this.clientExports.set('runscript', runScriptClientExport);
    this.clientExports.set('components', getComponentsClientExport);
    this.clientExports.set('addEditPatchComponent', addEditPatchComponentClientExport);

    return await super.load();
  }

  async runScript(request: FastifyRequest, scriptName: string, payload: any, opts?: any) {
    return await runScript(this, request, scriptName, payload, opts);
  }

  async runScriptFromWorkflow(ctx: WorkerContext, scriptName: string, payload: any, opts?: any) {
    return await runScript(this, ctx, scriptName, payload, opts);
  }
}

export { MercsDefaultIntegration, type MercsDefaultIntegrationConfig };
