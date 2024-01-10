/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// Integration for Workflows
// ---------------------------------------------------------------------------------------------

import {
  Collection,
  CreatePaginatedObject,
  EObjectAction,
  Workflow,
  omnilog,
  type IPaginatedObject,
  type IWorkflowMeta,
  type IntegrationsManager,
  type User
} from 'omni-shared';
import { v4 as uuidv4 } from 'uuid';
import { OMNITOOL_DOCUMENT_TYPES, type DBService, type QueryResult } from '../../services/DBService.js';
import { APIIntegration, type IAPIIntegrationConfig } from '../APIIntegration.js';
import {
  execWorkflowClientExport,
  execWorkflowHandler,
  startWorkflow,
  stopWorkflowClientExport,
  stopWorkflowHandler
} from './handlers/exec.js';
import { createJobsHandler, jobsClientExport } from './handlers/jobs.js';
import { OmniComponentMacroTypes } from 'omni-sockets';
import type MercsServer from '../../core/Server.js';
import { createGetWorkflowResultsHandler, getWorkflowResultsClientHandler } from './handlers/results.js';
import {
  cloneWorkflowHandler,
  cloneWorkflowHandlerClientExport,
  createDeleteWorkflowHandler,
  createGetWorkflowsHandler,
  createUpdateWorkflowHandler,
  createWorkflowClientExport,
  createWorkflowClientHandler,
  deleteWorkflowClientExport,
  downloadWorkflowHandler,
  getWorkflowsClientExport,
  loadWorkflowHandler,
  loadWorkflowHandlerClientExport,
  updateWorkflowHandlerClientExport
} from './handlers/workflow.js';
import { PermissionChecker } from '../../helper/permission.js';
import { KVStorage } from 'core/KVStorage.js';
import { readFileSync, unlinkSync } from 'fs';
import path from 'path';

interface IWorkflowIntegrationConfig extends IAPIIntegrationConfig {
  tempExportDir?: string,
}

// Workflow related indexes

class WorkflowIntegration extends APIIntegration {
  db: DBService;

  constructor(id: string, manager: IntegrationsManager, config: IWorkflowIntegrationConfig) {
    super(id, manager, config || {});

    this.db = manager.app.services.get('db') as DBService;
  }

  async load() {
    // @ts-ignore
    this.app.api2._post = {
      url_array_to_cdn: async function (ctx: any, data: any) {
        return await Promise.all(
          data.map((obj: { url: string }) => {
            return ctx.app.cdn.putTemp(obj.url, { userId: ctx.userId, jobId: ctx.jobId });
          })
        );
      }
    };

    // @ts-ignore
    this.startWorkflow = startWorkflow;
    this.handlers.set('load', loadWorkflowHandler);
    this.clientExports.set('load', loadWorkflowHandlerClientExport);

    this.handlers.set('create', createWorkflowClientHandler);
    this.clientExports.set('create', createWorkflowClientExport);
    this.handlers.set('clone', cloneWorkflowHandler);
    this.clientExports.set('clone', cloneWorkflowHandlerClientExport);
    this.handlers.set('update', createUpdateWorkflowHandler);
    this.clientExports.set('update', updateWorkflowHandlerClientExport);

    this.handlers.set('getWorkflows', createGetWorkflowsHandler);
    this.handlers.set('deleteWorkflow', createDeleteWorkflowHandler);
    this.handlers.set('results', createGetWorkflowResultsHandler);
    this.handlers.set('exec', execWorkflowHandler);
    this.handlers.set('stop', stopWorkflowHandler);
    this.handlers.set('jobs', createJobsHandler);
    this.handlers.set('download', downloadWorkflowHandler);

    this.clientExports.set('exec', execWorkflowClientExport);
    this.clientExports.set('stop', stopWorkflowClientExport);
    this.clientExports.set('getWorkflows', getWorkflowsClientExport);
    this.clientExports.set('deleteWorkflow', deleteWorkflowClientExport);
    this.clientExports.set('results', getWorkflowResultsClientHandler);
    this.clientExports.set('jobs', jobsClientExport);

    return await super.load();
  }

  async deleteWorkflow(workflow: Workflow) {
    const _id = `wf:${workflow.id}`;
    let _rev = workflow._rev;

    if (!_rev) {
      const doc = (await this.db.get(_id)) as Workflow;

      if (!doc) {
        throw new Error(`deleteWorkflow: workflow ${workflow.id} not found`);
      }
      _rev = doc?._rev;
    }

    return await this.db.delete({ _id, _rev });
  }

  // Creates a new Workflow
  async createWorkflow(data: { meta?: IWorkflowMeta; rete: any }, user: User): Promise<Workflow> {
    const id = uuidv4();

    if (user.organisation == null) {
      throw new Error(`createWorkflow: user ${user.id} does not have an organization`);
    }

    const meta = {
      created: Date.now(),
      updated: Date.now(),
      author: 'Anonymous',
      name: data.meta?.name ?? 'New Recipe',
      description: data.meta?.description ?? 'No description.',
      category: data.meta?.category ?? '',
      pictureUrl: data.meta?.pictureUrl ?? undefined,
      help: data.meta?.help ?? '',
      tags: (data.meta?.tags ?? []).filter((tag: string) => tag !== 'template') // Exclude 'template' tag
    };

    const workflow = new Workflow(id, {
      owner: user.id,
      org: user.organisation
    });
    workflow.setRete(data.rete);
    workflow.setMeta(meta);

    const result = await this.db.put(workflow);
    if (!result) {
      throw new Error(`createWorkflow: failed to create workflow ${id}`);
    }
    workflow._rev = result._rev;

    this.success(`Workflow ${workflow.id} created by ${user.id}`);
    return workflow;
  }

  // clones an existing workflow
  async cloneWorkflow(
    workflowId: string,
    version: string | undefined,
    user: User,
    meta?: Partial<IWorkflowMeta>
  ): Promise<Workflow | undefined> {
    omnilog.warn('cloneWorkflow: deprecated, use cloneRecipe instead');
    return await this.cloneRecipe(workflowId, user, meta);
  }

  async cloneRecipe(workflowId: string, user: User, meta?: Partial<IWorkflowMeta>): Promise<Workflow | undefined> {
    const existingWorkflow = await this.getRecipe(workflowId, user.id, true);

    if (existingWorkflow != null) {
      const wf: Workflow = JSON.parse(JSON.stringify(existingWorkflow));

      wf.meta = Object.assign(wf.meta, meta ?? { name: `${wf.meta.name} (my copy)` });
      const clonedWorkflow = await this.createWorkflow(
        {
          meta: wf.meta,
          rete: wf.rete
        },
        user
      );
      return clonedWorkflow;
    }
  }

  // Updates an existing workflow (but does not change the owner!)
  async updateWorkflow(
    workflowId: string,
    update: { rete?: any; meta?: IWorkflowMeta;},
    user: User | string,
    opts?: {
      suppressMacroExecution?: boolean;
    }
  ) {
    const userId: string = typeof user === 'object' ? user.id : user;

    const workflow = await this.getRecipe(workflowId, userId, false);

    if (!workflow) {
      console.log('Workflow not found for update');
      return;
    }

    let changed: boolean = false;

    if (update.rete) {
      workflow.setRete(update.rete);
      changed = true;
    }

    if (update.meta) {
      workflow.setMeta(update.meta);
      changed = true;
    }

    // -----------------------------------------------------------------------------------------------
    // Execute components with a recipe run function
    // A wee-bit wasteful, ....
    // -----------------------------------------------------------------------------------------------
    const mercsServer = this.app as MercsServer;
    const blockNames = Array.from(new Set(Object.values(workflow.rete.nodes).map((n: any) => n.name)));
    const blocks = (await (mercsServer.blocks.getInstances(blockNames, undefined))).blocks

    if (!opts?.suppressMacroExecution) {

      // We reset UI here because it gets rebuilt
      workflow.ui = {}

      await Promise.all(
        Array.from(Object.values(workflow.rete.nodes)).map(async (n: any) => {
          const c = blocks.find((b) => b.name === n.name);

          if (c != null && c.macros?.save) {
            const saveMacro = mercsServer.blocks.getMacro(c, OmniComponentMacroTypes.ON_SAVE);

            if (saveMacro) {
              try {
                changed = await saveMacro(n, workflow, {
                  app: mercsServer,
                  user: userId
                });
              } catch (ex) {
                omnilog.error(`Error executing macro ${OmniComponentMacroTypes.ON_SAVE} for ${c?.name}`, ex);
              }
            }
            else
            {
              omnilog.warn(`No ${OmniComponentMacroTypes.ON_SAVE} macro found for ${c?.name}`)
            }
          }
        })
      );
    }

    /* if (!changed) {
      return workflow
    } */

    const result = await this.db.put(workflow);
    workflow._rev = result._rev; // Update _rev from DB
    this.success(`Workflow ${workflow.id} updated by ${userId}`);

    return workflow;
  }

  async getWorkflow(
    id: string,
    version: string | undefined,
    user: string,
    allowPublic: boolean = true
  ): Promise<Workflow | null> {
    omnilog.warn('getWorkflow: deprecated, use getRecipe instead');
    return await this.getRecipe(id, user, allowPublic);
  }

  async getRecipe(id: string, user: string, allowPublic: boolean = true): Promise<Workflow | null> {
    if (!id) {
      throw new Error('getWorkflow: id is null');
    }
    const userIds: string[] = [];
    if (user) {
      userIds.push(user);
    }
    if (allowPublic) {
      userIds.push('-----public-----');
    }

    this.debug(`getWorkflow: id:${id} user:${user} allowPublic:${allowPublic}`);
    const workflowJson = await this.db.getDocumentById(OMNITOOL_DOCUMENT_TYPES.WORKFLOW, id, userIds, allowPublic);
    if (!workflowJson) {
      return null;
    }
    return Workflow.fromJSON(workflowJson);
  }

  async getWorkflowSummariesAsCollection(ownerIds: string[], includePublic: boolean): Promise<Collection> {
    const records = await this.db.getDocumentsByOwnerId(OMNITOOL_DOCUMENT_TYPES.WORKFLOW, ownerIds, includePublic);
    const collection = new Collection('creator', 'owner', 'org', null);

    records.docs.forEach((doc: any) => {
      collection.add({
        type: OMNITOOL_DOCUMENT_TYPES.WORKFLOW,
        id: doc._id.replace('wf:', ''),
        value: {
          name: doc.meta?.name || 'unknownName',
          owner: doc.meta?.owner || doc.owner,
          pictureUrl: doc.meta.pictureUrl || doc.pictureUrl || '',
          description: doc.meta.description || doc.description || 'unknownDesc',
          aiUsage: doc.ai_usage ?? doc.aiUsage ?? '',
          created: doc.created
        }
      });
    });

    return collection;
  }

  async getWorkflowsForSessionUser(
    ctx: any,
    docsPerPage: number,
    page: number, // zero index paging
    filter: string = ''
  ): Promise<IPaginatedObject> {
    // Build list of owner IDs to search for.
    const userIds: string[] = [ctx.user.id, '-----public-----'];

    // Create filters
    const queryFilter = new Map<string, string>();
    if (filter !== '') {
      queryFilter.set('id', filter);
      queryFilter.set('meta.name', filter);
      queryFilter.set('meta.description', filter);
      queryFilter.set('meta.tags', filter);
    }

    // Fetch workflows from the database.
    const result: QueryResult = await this.db.getDocumentsByOwnerIdV2(
      OMNITOOL_DOCUMENT_TYPES.WORKFLOW,
      userIds,
      page,
      docsPerPage,
      queryFilter
    );

    // Sort descending by updated date
    if (result.docs) {
      result.docs.sort((a: any, b: any) => {
        return b.meta.updated - a.meta.updated;
      });  
    }

    const ability = new PermissionChecker(ctx.session.get('permission'));
    const workflows = result.docs.map((x) => {
      const workflow: any = Workflow.fromJSON(x);
      return {
        _id: workflow._id,
        _rev: workflow._rev,
        canDelete: ability.can(EObjectAction.DELETE, workflow),
        id: workflow.id,
        meta: workflow.meta,
        org: workflow.org,
        ui: workflow.ui,
        owner: workflow.owner
      };
    });
    const responseObj = CreatePaginatedObject();
    responseObj.data = workflows;
    responseObj.page = result.page;
    responseObj.docsPerPage = result.docsPerPage;
    responseObj.totalPages = result.totalPages;
    responseObj.totalDocs = result.totalDocs;
    return responseObj;
  }

  async exportWorkflow(workflowId: string, userId: string, fileName: string):Promise<Buffer> {
    omnilog.debug('exportWorkflow', workflowId, userId)
    const workflow = await this.getRecipe(workflowId, userId, true);

    if (!workflow) {
      throw new Error('Workflow not found')
    }

    const blockNames = Array.from(new Set(Object.values(workflow.rete.nodes).map((n: any) => n.name)));
    //@ts-ignore
    const blocks = (await this.app.blocks.getInstances(blockNames, userId, undefined))?.blocks;

    if (!blocks || blocks.length === 0) {
      throw new Error('Invalid workflow')
    }

    // Create a new KV storage file for export
    //@ts-ignore
    const exportFile = new KVStorage(this, {

      // @ts-ignore
      dbPath: this.config.tempExportDir ?? this.config.settings?.paths?.tmpPath ?? './data.local/tmp',
      dbName: fileName
    });
    await exportFile.init();
    
    await Promise.all(Object.values(workflow.rete.nodes).map(async (n: any) => {
      const c = blocks.find((b:any) => b.name === n.name);

      for (const inputKey of Object.keys(c.inputs)) {
        // Data format is password
        if (c.inputs[inputKey].format === 'password') {
          n.data[inputKey] = '';
        }

        // CDN socket
        if (['image', 'file', 'audio', 'video', 'document'].includes(c.inputs[inputKey].customSocket)) {
          // Node data is an fid: Load the file from CDN and save in KV storage
          if (n.data[inputKey] && n.data[inputKey].startsWith('fid:')) {
            // @ts-ignore
            const resource = await this.app.cdn.get({fid: n.data[inputKey].replace('fid://', '')})
            omnilog.debug('Resource', resource.data ? resource.data.length : 'null')
            if (resource) {
              exportFile.set(n.data[inputKey], resource.data);
            }
          }
        }
      }
    }));

    exportFile.set(`wf:${workflow.id}`, workflow);
    await exportFile.stop();

    const exportFilePath = path.join(exportFile.config.dbPath, fileName);
    const fileBuff = readFileSync(exportFilePath);
    // Delete the temporary file
    unlinkSync(path.join(exportFile.config.dbPath, fileName));

    return fileBuff;
  }

  async importWorkflow(userId: string, fid: string): Promise<Workflow | null> {
    //@ts-ignore
    const resource = await this.app.cdn.get({fid: fid.replace('fid://', '')})

    // Initialize KV with the CDN file
    //@ts-ignore
    const kv = new KVStorage(this.app, {
      //@ts-ignore
      dbPath: this.config.tempExportDir ?? './data.local/tmp',
    });

    await kv.initFromBuffer(resource.data);

    // Get the packaged CDN files from KV storage
    // const newFidMap = new Map<string, string>();
    // const cdnEntries = kv.getAny('fid://');
    // for (const kvPair of cdnEntries) {
    //   // Save all the files in the CDN storage
    //   //@ts-ignore
    //   const cdnResource = await this.app.cdn.put(kvPair.value, {userId})
    //   newFidMap.set(kvPair.key.replace('fid://',''), cdnResource.fid);      
    // }

    // Get the workflow from the KV storage
    const kvEntries = kv.getAny('wf:');
    if (!kvEntries || kvEntries.length === 0) {
      throw new Error('No workflows to be imported')
    }

    // Iterate over all workflows
    const result: Workflow[] = []
    for (const kvPair of kvEntries) {
      const workflow = kvPair.value as Workflow;

      const blockNames = Array.from(new Set(Object.values(workflow.rete.nodes).map((n: any) => n.name)));
      //@ts-ignore
      const blocks = (await this.app.blocks.getInstances(blockNames, userId, undefined))?.blocks;

      // For all the nodes in the workflow, check if there are any CDN sockets
      for (const node of Object.values(workflow.rete.nodes)) {
        // @ts-ignore
        const block = blocks.find((b:any) => b.name === node.name);
        if (!block) {
          throw new Error(`Block ${node.name} not found`)
        }

        // Iterate over all the inputs of the block
        for (const inputKey of Object.keys(block.inputs)) {
          // Check if the input is a CDN socket
          if (['image', 'file', 'audio', 'video', 'document'].includes(block.inputs[inputKey].customSocket)) {
            // Check if the node data is an fid
            if (node.data[inputKey] && typeof node.data[inputKey] === 'string' && (node.data[inputKey] as string).startsWith('fid:')) {
              // Check if the fid exists in the KV storage
              const keyValue = kv.get(node.data[inputKey] as string);
              if (keyValue !== undefined) {
                // @ts-ignore
                const resource = await this.app.cdn.put(node.data[inputKey].replace('fid://', ''), { userId });
                node.data[inputKey] = `fid://${resource.fid}`;
              }
            }
          }
        }
      }

      result.push(workflow);
    }

    return result
  }

}

export { WorkflowIntegration, type IWorkflowIntegrationConfig };
