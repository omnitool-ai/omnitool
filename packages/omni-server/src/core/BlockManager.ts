/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//  ----------------------------------------------------------------------------------------------
//  BlockManager.ts
//
//    Purpose: Manage the blocks that are available to the server.
//             Provide on demand block composition.
//  ----------------------------------------------------------------------------------------------

import MurmurHash3 from 'imurmurhash';
import path from 'path';
import type MercsServer from './Server.js';

import { existsSync } from 'fs';
import { access, readFile, readdir, stat } from 'fs/promises';
// import { existsSync, promises as fs } from 'fs';
import yaml from 'js-yaml';
import {
  OAIBaseComponent,
  OAIComponent31,
  WorkerContext,
  type OmniAPIAuthenticationScheme,
  type OmniAPIKey,
  type OmniComponentFormat,
  type OmniComponentMacroTypes,
  type OmniComponentPatch,
  type OmniNamespaceDefinition
} from 'omni-sockets';
import { Manager, omnilog, type IApp, type IBlockOrPatchSummary } from 'omni-shared';

import SwaggerClient from 'swagger-client';
import { type AmqpService } from '../services/AmqpService.js';
import { OpenAPIReteAdapter } from '../services/ComponentService/OpenAPIReteAdapter.js';
import { KVStorage, type IKVStorageConfig } from './KVStorage.js';
import { KNOWN_EXTENSION_METHODS} from './ServerExtensionsManager.js';
import { type NodeData } from 'rete/types/core/data.js';
import { OmniDefaultBlocks } from '../blocks/DefaultBlocks.js';
import { StorageAdapter } from './StorageAdapter.js';

import { type CredentialService } from 'services/CredentialsService/CredentialService.js';

interface IBlockManagerConfig {
  preload: boolean;
  kvStorage: IKVStorageConfig;
}

type UndefinedPruned<T> = T extends object ? { [P in keyof T]: UndefinedPruned<T[P]> } : T;

function removeUndefinedValues<T>(obj: T): UndefinedPruned<T> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj as UndefinedPruned<T>;
  }

  const result: Partial<UndefinedPruned<T>> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = (obj as any)[key];
      if (value !== undefined) {
        result[key as keyof T] = removeUndefinedValues(value);
      }
    }
  }

  return result as UndefinedPruned<T>;
}

class BlockManager extends Manager {
  ReteAdapter: typeof OpenAPIReteAdapter = OpenAPIReteAdapter;
  BaseComponent: typeof OAIBaseComponent = OAIBaseComponent;

  private readonly factories: Map<string, Function>; // This holds component factories
  private readonly namespaces: StorageAdapter<OmniNamespaceDefinition>; // This holds namespaces
  private readonly patches: StorageAdapter<OmniComponentPatch>; // This holds patches
  private readonly blocks: StorageAdapter<OmniComponentFormat>; // This holds blocks
  private readonly blocksAndPatches: StorageAdapter<OmniComponentFormat | OmniComponentPatch>; // This holds blocks and patches
  private readonly macros: Map<string, Function>; // This holds functions attached to blocks
  private readonly cache: StorageAdapter<any>; // This holds cached entries

  private readonly config: IBlockManagerConfig;
  public _kvStorage?: KVStorage;

  constructor(app: IApp, config: IBlockManagerConfig) {
    super(app);
    this.config = config;

    this.blocks = new StorageAdapter<OmniComponentFormat>('block:'); /* ) new Map<string, OmniComponentFormat>() */
    this.patches = new StorageAdapter<OmniComponentPatch>('patch:');
    this.blocksAndPatches = new StorageAdapter<OmniComponentFormat | OmniComponentPatch>();
    this.namespaces = new StorageAdapter<OmniNamespaceDefinition>('ns:');
    this.cache = new StorageAdapter<any>('cache:', undefined, 60 * 60 * 24);

    // Type factories and macros
    this.factories = new Map<string, Function>();
    this.macros = new Map<string, Function>();

    this.registerType('OAIComponent31', OAIComponent31.fromJSON);

    app.events.on('credential_change', (e: any) => {
      this.cache.clearWithPrefix();
    });
  }

  get kvStorage(): KVStorage {
    if (this._kvStorage == null) {
      throw new Error('BlockManager kvStorage accessed before load');
    }
    return this._kvStorage;
  }

  async init() {
    const kvConfig = this.config.kvStorage;
    if (kvConfig) {
      this._kvStorage = new KVStorage(this.app, kvConfig);
      // Need to register view before init() call
      this._kvStorage.registerView(
        'BlocksAndPatches',
        `CREATE VIEW IF NOT EXISTS BlocksAndPatches (key,
        value,
        valueType,
        blob,
        expiry,
        tags,
        deleted,
        seq) AS
      SELECT
            key,
            value,
            valueType,
            blob,
            expiry,
            tags,
            deleted,
            ROW_NUMBER() OVER (ORDER BY seq DESC) AS new_seq
        FROM
            kvstore
        WHERE
            (key LIKE 'block:%' OR key LIKE 'patch:%')
            AND deleted = 0;`
      );
      if (!(await this.kvStorage.init())) {
        throw new Error('KVStorage failed to start');
      }

      const resetDB = (this.app as MercsServer).options.resetDB;
      if (resetDB?.split(',').includes('blocks')) {
        this.info('Resetting blocks storage');
        this.kvStorage.clear();
      }
      await this.kvStorage.vacuum();

      this.app.events.on('register_blocks', (blocks: OmniComponentFormat[]) => {
        blocks.forEach((block) => {
          this.addBlock(block);
        });
      });

      this.app.events.on('register_patches', (patches: OmniComponentPatch[]) => {
        patches.forEach((patch) => {
          this.addPatch(patch);
        });
      });

      this.app.events.on('register_macros', (macros: Record<string, Function>) => {
        Object.entries(macros || {}).forEach(([key, value]) => {
          this.registerMacro(key, value);
        });
      });

      this.blocks.bindStorage(this.kvStorage);
      this.namespaces.bindStorage(this.kvStorage);
      this.patches.bindStorage(this.kvStorage);
      this.cache.bindStorage(this.kvStorage);
      this.blocksAndPatches.bindStorage(this.kvStorage);
    }

    OmniDefaultBlocks.forEach((block) => {
      this.addBlock(block);
    });

    this.registerExecutors();

    if (this.config.preload) {
      await this.preload();
    }

    this.info('BlockManager initialized');
    return true;
  }

  formatHeader(blockOrPatch: {
    title?: string;
    description?: string;
    category?: string;
    displayNamespace: string;
    displayOperationId: string;
    tags?: string[];
  }): IBlockOrPatchSummary {
    return {
      title: blockOrPatch.title ?? `${blockOrPatch.displayNamespace + '.' + blockOrPatch.displayOperationId}`,
      description: blockOrPatch.description ?? '',
      category: blockOrPatch.category,
      name: `${blockOrPatch.displayNamespace + '.' + blockOrPatch.displayOperationId}`,
      tags: blockOrPatch.tags ?? []
    };
  }

  async stop() {
    await this.kvStorage.stop();
    await super.stop();

    this.info('BlockManager stopped');
    return true;
  }

  private registerExecutors() {
    const amqpService = this.app.services.get('amqp') as AmqpService;

    // @ts-ignore
    this.app.api2 ??= {};
    // @ts-ignore
    this.app.api2.execute = async (
      api: string,
      body?: any,
      requestConfig?: {
        headers?: any;
        params?: any;
        responseType?: string;
        responseEncoding?: string;
        timeout: 0;
      },
      ctx?: any
    ) => {
      if (!ctx.userId || !ctx.sessionId) {
        this.debug('execute() called without ctx.userId or ctx.sessionId');
      }

      const oid = api.split('.');
      const integrationId = oid.shift();
      const opKey = oid.join('.');

      await this.app.events.emit('pre_request_execute', [ctx, api, { body, params: requestConfig?.params ?? {} }]);
      omnilog.log('Executing', integrationId, opKey, body, requestConfig, ctx);

      let result: any;
      try {

        result = await amqpService.publishAwaitable(
          'omni_tasks',
          undefined,
          Object.assign({}, { integration: { key: integrationId, operationId: opKey, block: api } }, { body }, requestConfig, {
            job_ctx: ctx
          })
        );
      } catch (e: unknown) {
        this.error('Error executing', api, e);
        result = { error: e };
      } finally {
        try {
          await this.app.events.emit('post_request_execute', [
            ctx,
            api,
            { body, params: requestConfig?.params ?? {}, result }
          ]);
        } catch (ex) {
          omnilog.error(ex);
        }
      }
      if (result.error) {
        throw result.error;
      }
      return result;
    };
  }


  private async preloadDir(registryDir:string, prefix?: string)
  {
    // check if directory exists
    if (!await this.checkDirectory(registryDir)) {
      return;
    }

    const registryFiles = await readdir(registryDir);
    this.debug(`Scanning registry folder ${registryDir}, containing ${registryFiles.length} files.`);

    const tasks = registryFiles.map(async (file) => {
      if (file.startsWith('.')) {
        return null;
      }
      const filePath = path.join(registryDir, file);
      const s = await stat(filePath);
      if (s.isDirectory()) {
        await this.registerFromFolder(filePath, prefix, (this.app as MercsServer).options.refreshBlocks);
      }
    });

    await Promise.all(tasks);
  }

  // Preload APIS
  private async preload() {
    const start = performance.now(); // Start timer

    //const testDir =  process.cwd() + '/data.local/apis-testing/';
    //@ts-ignore
    const apisTestingPath = this.app.config.settings.paths?.apisTestingPath || 'data.local/apis-testing';
    const testDir = path.join(process.cwd(), apisTestingPath)
    await this.preloadDir(testDir, 'test')

    // First load the local apis defined by the user
    //const localDir =  process.cwd() + '/data.local/apis-local/';
    //@ts-ignore
    const apisLocalPath = this.app.config.settings.paths?.apisLocalPath || 'data.local/apis-local';
    const localDir = path.join(process.cwd(), apisLocalPath)

    await this.preloadDir(localDir, 'local')

    const registryDir = process.cwd() + '/extensions/omni-core-blocks/server/apis/';
    await this.preloadDir(registryDir)

    const end = performance.now(); // End timer
    this.info(`BlockManager preload completed in ${(end - start).toFixed()}ms`);
  }

  async uninstallNamespace(ns: string, prefix: string = 'local') {
    // sanitize
    ns = ns.replace(/[^a-zA-Z0-9-_]/g, '');
    if (ns.length <3) {
      throw new Error('Namespace too short');
    }
    const name = `${prefix}-${ns}`
    if (!this.namespaces.get(name)) {
      throw new Error('Namespace '+name+'not found');
    }
    this.info(`Uninstalling namespace ${name}`);
    this._kvStorage?.runSQL(`DELETE FROM kvstore WHERE key LIKE ?`, `%:${name}%`);
  }

  async registerFromFolder(dirPath: string, prefix?:string, forceRefresh:boolean=false): Promise<void> {
    const start = performance.now(); // Start timer
    const files = await readdir(dirPath);

    await Promise.all(
      files.map(async (file) => {
        if (file.endsWith('.yaml')) {
          try {
            // load the yaml file
            const nsData = yaml.load(await readFile(path.join(dirPath, file), 'utf8')) as OmniNamespaceDefinition;

            if (!nsData.title) {
              nsData.title = nsData.namespace;
            }

            if (prefix)
            {
              nsData.namespace = `${prefix}-${nsData.namespace}`;
              nsData.title = `$${nsData.title} (${prefix})`;
              nsData.prefix = prefix
            }

            // get the namespace
            const ns =  nsData.namespace;
            const url = nsData.api?.url ?? nsData.api?.spec ?? nsData.api?.json;
            if (!ns || !url) {
              this.error(`Skipping ${dirPath}\\${file} as it does not have a valid namespace or api field`);
              return;
            }

            if (this.namespaces.has(ns) && !forceRefresh) {
              this.debug('Skipping namespace ' + ns + " as it's already registered");
              await Promise.resolve();
              return;
            }

            await this.addNamespace(ns, nsData, true);
            const opIds: string[] = [];
            const patches: OmniComponentPatch[] = [];

            const cDir = path.join(dirPath, 'blocks');

            if (await this.checkDirectory(cDir)) {
              const components = await readdir(cDir);
              await Promise.all(
                components.map(async (component) => {
                  if (component.endsWith('.yaml')) {
                    // load the yaml file
                    const patch = yaml.load(await readFile(cDir + '/' + component, 'utf8')) as any;
                    if (nsData.prefix)
                    {
                      patch.title = `${patch.title} (${nsData.prefix})`;
                      patch.apiNamespace = `${nsData.prefix}-${patch.apiNamespace}`;
                      patch.displayNamespace = `${nsData.prefix}-${patch.displayNamespace}`;
                      patch.tags = patch.tags ?? [];
                      patch.tags.push(nsData.prefix);
                    }
                    opIds.push(patch.apiOperationId);
                    patches.push(patch);
                  }
                })
              );
            }

            this.info(`Loading ${url} as ${ns}`);

            try {
              await this.blocksFromNamespace(nsData, dirPath, opIds, patches);
              await this.processPatches(patches);
            } catch (e) {
              this.error(`Failed to process ${ns} ${url}`, e);
            }
          } catch (error) {
            this.warn(`Failed to register from ${path.join(dirPath, file)}`, error);
          }
        }
      })
    );

    const end = performance.now(); // Start timer
    this.info(`BlockManager registerFromFolder from ${dirPath} in ${(end - start).toFixed()}ms`);
  }

  private async loadAPISpec(currDir: string, api: { url?: string; json?: string; spec?: string }): Promise<any> {
    const start = performance.now(); // Start timer

    let parsedSchema = null;

    if (api.url != null) {
      this.info('Loading API from URL', api.url);
      try {
        // @ts-ignore
        parsedSchema = await SwaggerClient.resolve({ url: api.url });
      } catch (error) {
        this.error(error);
        throw new Error(`Failed to load spec from ${api.url}`);
      }
    } else if (api.json) {
      this.info('Loading API from JSON', api.json);
      // @ts-ignore
      parsedSchema = await SwaggerClient.resolve({ spec: api.json });
    } else if (api.spec != null) {
      this.info('Loading API from SPEC', api.spec);
      const specPath = path.join(currDir, api.spec);
      if (existsSync(specPath)) {
        const spec = yaml.load(await readFile(specPath, 'utf8')) as any;
        // @ts-ignore
        parsedSchema = await SwaggerClient.resolve({ spec });
      } else {
        this.error(`Spec file ${specPath} not found`);
        throw new Error(`Spec file ${specPath} not found`);
      }
    } else {
      throw new Error('No url or spec provided');
    }

    const end = performance.now(); // End timer
    this.info(`loadAPISpec ${currDir} completed in ${(end - start).toFixed(1)} milliseconds`);
    return parsedSchema?.spec ?? parsedSchema;
  }

  private async checkDirectory(path: string) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async blocksFromNamespace(
    nsData: OmniNamespaceDefinition,
    dir: string,
    filterOpIds: string[],
    patches: OmniComponentPatch[]
  ) {
    const ns = nsData.namespace;
    this.info(`Processing API ${ns}`, filterOpIds, patches?.length ?? 0);
    const specDoc = await this.loadAPISpec(dir, nsData.api ?? {});

    if (!specDoc) {
      this.error(`Error: Could not fetch OpenAPI spec for ${ns}`);
      return;
    }

    const adapter = new OpenAPIReteAdapter(ns, specDoc, nsData.api?.auth);
    const blocks = adapter.getReteComponentDefs(/* filterOpIds */);

    this.info('------ Adding Blocks ------');

    for (const c of blocks) {
      const key = `${c.displayNamespace}.${c.displayOperationId}`;

      // Add to new blocks manager
      if (!this.hasBlock(key)) {
        try {
          this.addBlock(c);
          this.verbose(`Added Block "${key}"`);
        } catch (e) {
          this.error(`Failed to add block "${key}"`, e);
          return;
        }
      }
    }
  }

  private async processPatches(patches: OmniComponentPatch[]) {
    this.info('------ Adding Patches ------');

    for (const p of patches) {
      const key = `${p.displayNamespace}.${p.displayOperationId}`;
      try {
        if (!this.blocks.has(`${p.apiNamespace}.${p.apiOperationId}`)) {
          this.warn(
            `Patch ${p.displayNamespace}.${p.displayOperationId} skipped as base block ${p.apiNamespace}.${p.apiOperationId} was not found`
          );
        } else {
          if (this.patches.has(key)) {
            this.verbose(`Patch ${key} already registered, overwriting`);
          }
          const allowOverwrite = true;
          this.addPatch(p, allowOverwrite);
        }
      } catch (e) {
        this.error(`Failed to add patch ${key}`, e);
      }

      this.info(`Adding patch ${key}`);
    }
  }

  getBlock(key: string): OmniComponentFormat | undefined {
    return this.blocks.get(key);
  }

  public async addNamespace(key: string, namespace: OmniNamespaceDefinition, allowOverwrite?: boolean) {
    if (!key) throw new Error('addNamespace(): key cannot be undefined');
    if (!namespace) {
      throw new Error('addNamespace(): namespace cannot be undefined');
    }
    if (this.namespaces.has(key) && !allowOverwrite) {
      throw new Error(`addNamespace(): namespace ${key} already registered`);
    }
    this.namespaces.set(key, namespace);

    await this.app.events.emit('register_namespace', namespace);

    return this;
  }

  public addPatch(patch: OmniComponentPatch, allowOverwrite?: boolean) {
    const key = `${patch.displayNamespace}.${patch.displayOperationId}`;
    if (!key) throw new Error('addPatch(): key cannot be undefined');
    if (!patch) throw new Error('addPatch(): patch cannot be undefined');
    if (this.patches.has(key) && !allowOverwrite) {
      throw new Error(`addPatch(): patch ${key} already registered`);
    }

    // We use these to identify the base blocks, so patches without them are invalid
    if (!patch.apiNamespace) {
      throw new Error(`addPatch(): patch ${key} is missing apiNamespace`);
    }
    if (!patch.apiOperationId) {
      throw new Error(`addPatch(): patch ${key} is missing apiOperationId`);
    }

    this.info('Registering patch', key);
    patch = removeUndefinedValues(patch);
    patch.hash = BlockManager.hashObject(patch);
    this.patches.set(key, patch);
  }

  getMacro(component: OAIBaseComponent, macroType: OmniComponentMacroTypes): Function | undefined {
    let macro = component?.macros?.[macroType];

    if (typeof macro === 'string') {
      macro = this.macros.get(macro);
    }

    if (typeof macro === 'function') {
      return macro.bind(component);
    }

    return undefined;
  }

  hashObject(obj: any) {
    return BlockManager.hashObject(obj);
  }

  static hashObject(obj: any) {
    if (obj.patch) delete obj.patch;
    const hashState = new MurmurHash3();
    const hash = hashState.hash(JSON.stringify(obj)).result().toString(16);
    return hash;
  }

  public registerMacro(key: string, macro: Function) {
    this.macros.set(key, macro);
  }

  public addBlock(block: OmniComponentFormat) {
    const key = `${block.apiNamespace}.${block.apiOperationId}`;
    if (!block) throw new Error(`Block ${key} is undefined`);
    if (!block.type) throw new Error(`Block ${key} is missing type`);
    if (!this.factories.has(block.type)) {
      throw new Error(`Block ${key} has unknown type ${block.type}` + Array.from(this.factories.keys()).toString());
    }

    if (block.displayNamespace !== block.apiNamespace || block.displayOperationId !== block.apiOperationId) {
      throw new Error(
        `addBlock(): Block ${key} has mismatched display and api namespaces, indicating it is a patch. Use addPatch() instead`
      );
    }

    this.debug('Registering block', key);

    /*
      Macros

      Macros are functions attached to a blocks' macro collection. Since we don't want to serialize functions into the database, we rely on them getting
      registered on every startup, from 2 potential sources:

      1. The block itself, which can have a macro collection with functions. These are registered as macro://<block_key>:<namespace>.<operationId>
      2. Extensions, which can export macros along with the createComponent function. These are picked up by the extension manager and fired as register_macros event
         which is picked up here. This is useful to allow many blocks to use the same exec function for example
    */
    const macros = block.macros;

    if (macros && Object.keys(macros).length > 0) {
      for (const m in macros) {
        // @ts-ignore
        const macro = macros[m];
        this.verbose('Registering macro', m);

        if (typeof macro === 'function') {
          const macroKey = 'macro://' + m + ':' + block.displayNamespace + '.' + block.displayOperationId;

          this.registerMacro(macroKey, macro);
          // @ts-ignore
          macros[m] = macroKey;
        } else if (typeof macro === 'string') {
          // @ts-ignore
          if (!this.macros.has(macro)) {
            throw new Error(`Block ${key} has unknown macro ${m}. The Macro has to be registered before the block`);
          }
        }
      }
    }

    block = removeUndefinedValues(block) as OmniComponentFormat;
    block.hash = BlockManager.hashObject(block);

    this.blocks.set(key, block);
  }

  public hasBlock(key: string): boolean {
    if (!key) throw new Error('hasBlock(): key cannot be undefined');
    return this.blocks.has(key);
  }

  public async canRunBlock(block: OAIBaseComponent, userId: string): Promise<boolean> {
    if (!block) throw new Error('canRunBlock(): block cannot be undefined');

    const credentialsService = this.app.services.get('credentials') as CredentialService | undefined;
    if (!credentialsService) {
      throw new Error('Credentials service unavailable');
    }

    return await credentialsService.hasSecret(userId, block.apiNamespace);
  }

  public registerType(key: string, Factory: Function): void {
    if (!key) throw new Error('registerType(): key cannot be undefined');
    if (!Factory || typeof Factory !== 'function') {
      throw new Error(`Factory ${key} must be a function`);
    }
    if (this.factories.has(key)) {
      throw new Error(`Block type ${key} already registered`);
    }

    this.factories.set(key, Factory);
  }

  // return a composed block. If the key responds to a patch, the patch is applied to the underlying block
  public async getInstance(key: string, userId?: string): Promise<OAIBaseComponent | undefined> {
    const patch = this.patches.get(key);

    const baseKey = patch ? `${patch.apiNamespace}.${patch.apiOperationId}` : key;

    const block = this.blocks.get(baseKey);

    if (!block) {
      return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const Factory = this.factories.get(block.type)!; // Block types are guaranteed on insert so we can ! here
    const ret = Factory(block, patch) as OAIComponent31;

    if (block.dependsOn) {
      const check = block.dependsOn.filter((d: string) => !this.hasBlock(d) && !this.patches.has(d));

      if (check.length > 0) {
        ret.data.errors.push(`Missing dependencies: ${check.join(',')}`);
      }
    }

    ret.data.tags.push(patch ? 'patch' : 'base-api');

    const hideInputs = ret.scripts?.['hideExcept:inputs'];
    if (hideInputs?.length) {
      for (const k in ret.inputs) {
        ret.inputs[k].hidden = ret.inputs[k].hidden ?? !hideInputs.includes(k);
      }
    }

    const hideOutputs = ret.scripts?.['hideExcept:outputs'];
    if (hideOutputs?.length) {
      for (const k in ret.outputs) {
        ret.outputs[k].hidden = ret.outputs[k].hidden ?? !hideOutputs.includes(k);
      }
    }

    // TODO: Do not hide _omni_result socket for now as it is easier to debug and surface issue
    // Once there is patch, hide _omni_result socket in outputs if it exists
    // if (patch && Object.keys(ret.outputs ?? {}).length > 1 && ret.outputs?._omni_result) {
    //   ret.outputs['_omni_result'].hidden = true;
    // }

    if (userId && !(await this.canRunBlock(ret, userId))) {
      ret.data.errors.push('Block cannot run');
    }

    return ret as OAIBaseComponent;
  }

  public async tryResolveExtensionBlock(ctx: any, key: string): Promise<OAIBaseComponent|undefined>
  {
    // if an extension is involved, the block key is in the form of <extension_name>:<block_key>
    if (key.indexOf(':') > 0)
    {
      const server = (this.app as MercsServer)
      const [extensionId, blockKey] =   key.split(':');

      if (server.extensions.has(extensionId))
      {
        const extension = server.extensions.get(extensionId);
        if (extension)
        {
          const block = await extension.invokeKnownMethod(KNOWN_EXTENSION_METHODS.resolveMissingBlock, ctx, blockKey)

          if (block)
          {
            return block;
          }
          else
          {
            return undefined;
          }
        }
      }
    }
  }


  public async getInstances(
    keys: string[],
    userId?: string,
    failBehavior: 'throw' | 'filter' | 'missing_block' = 'throw'
  ): Promise<{blocks: OAIBaseComponent[], missing: string[]}> {
    if (!keys || !Array.isArray(keys)) {
      throw new Error('getInstances(keys): keys must be string[]');
    }
    const missing:string[] = []

    const promises = keys.map(async (key) => {
      const block = await this.getInstance(key, userId);
      if (block) {
        return block;
      }
      missing.push(key)
      if (failBehavior === 'throw') {
        const patch = this.patches.get(key);
        if (patch) {
          throw new Error(`Unable to compose patched block "${key}" / "${patch.apiNamespace}.${patch.apiOperationId}"`);
        }
        throw new Error(`Unable to find block "${key}"`);
      }

      if (failBehavior === 'missing_block') {
        omnilog.warn(`[getInstances] Unable to compose block "${key}"`); // Caution: `key` may differ from patched key
        const result = await this.getInstance('omnitool._block_missing', userId);
        if (result)
        {
          result.data.errors.push(`Unable to compose block "${key}"`);
          //@ts-ignore
          result.data._missingKey = key;
        }
        return result;
      }
      return undefined;
    });

    let result = await Promise.all(promises);

    if (failBehavior === 'filter') {
      result = result.filter((r) => r);
    }
    return {blocks: (result ?? []) as OAIBaseComponent[], missing}
  }

  public getAllNamespaces(opts?: { filter: any }): OmniNamespaceDefinition[] {
    let all = Array.from(this.namespaces.values());
    if (opts?.filter) {
      all = all.filter((n: OmniNamespaceDefinition) => n.namespace === opts.filter);
    }
    return all;
  }

  private orderByTitle(a: IBlockOrPatchSummary, b: IBlockOrPatchSummary) {
    const aKey = a?.title ?? a?.name ?? '';
    const bKey = b?.title ?? b?.name ?? '';
    const locale = 'en-US-POSIX'; // Ensure consistent string comparison, similar to the "C" locale.
    return aKey.toLowerCase().localeCompare(bKey.toLowerCase(), locale);
  }

  public getFilteredBlocksAndPatches(
    limit: number,
    cursor: number,
    keyword: string,
    opts?: { contentMatch: string; tags: string }
  ): Array<[number, IBlockOrPatchSummary]> {
    const maxLimit = 9999;
    const filter = keyword.replace(/ /g, '').toLowerCase() ?? '';
    const blockAndPatches = this.blocksAndPatches.search(
      maxLimit,
      0,
      filter,
      opts?.contentMatch,
      opts?.tags,
      'BlocksAndPatches'
    );
    const all: Array<[number, IBlockOrPatchSummary]> = [];
    if (blockAndPatches) {
      for (const item of blockAndPatches) {
        const itemFormatHeader = this.formatHeader(item[1]);
        if (itemFormatHeader.tags?.includes('base-api')) continue;
        all.push([item[2], itemFormatHeader]);
      }
    }
    all.sort((a, b) => this.orderByTitle(a[1], b[1]));
    return all.slice(cursor, cursor + limit);
  }

  public getNamespace(key: string): OmniNamespaceDefinition | undefined {
    return this.namespaces.get(key);
  }

  public getBlocksForNamespace(ns: string): OmniComponentFormat[] {
    // TODO: Gezo: This doesn't actually work, it ignores anything that's a patch.
    // We first need to retrieve all patches for the namespace, then get blocks that do not have patches
    // GetInstance handles this for example

    return Array.from(this.blocks.values()).filter((block: OmniComponentFormat) => block.apiNamespace === ns);
  }

  public async getAllBlocks(
    includeDefinitions: boolean = true,
    filter?: any
  ): Promise<Array<OAIBaseComponent | string>> {
    const patches = Array.from(this.patches.keys());

    if (includeDefinitions) {
      // TODO: We actually want to return header information here, keys alone are not so useful
      let blocks = Array.from(this.blocks.keys());

      // Build a set from the keys in patches.
      const patchSet = new Set(patches);

      // Filter blocks if they alias a patch.
      blocks = blocks.filter((key) => !patchSet.has(key));

      return [...blocks, ...patches];
    }

    const patchInstances = (await Promise.all(patches.map(async (key) => await this.getInstance(key)))).filter(
      Boolean
    ) as OAIBaseComponent[];

    const blocks = Array.from(this.blocks.keys()).filter(
      (key) => !patchInstances.find((p: OAIBaseComponent) => p.name === key)
    );
    const blockInstances = (await Promise.all(blocks.map(async (key) => await this.getInstance(key)))).filter(
      Boolean
    ) as OAIBaseComponent[];

    return [...blockInstances, ...patchInstances];
  }

  public getRequiredCredentialsForBlock(key: string): OmniAPIKey[] {
    const block = this.blocks.get(key);
    if (!block) throw new Error(`Block ${key} not found`);

    const securitySchemes = block.security;

    if (!securitySchemes || securitySchemes.length <= 0) {
      return [];
    }

    const requiredCredentials: OmniAPIKey[] = [];
    // For each security scheme, parse the required credentials
    for (const scheme of securitySchemes) {
      scheme.requireKeys?.forEach((key: OmniAPIKey) => {
        const existing = requiredCredentials.find((k) => k.id === key.id);
        if (!existing) {
          requiredCredentials.push(key);
        }
      });
    }

    return Array.from(requiredCredentials);
  }

  public getRequiredCredentials(namespace: string, includeOptional: boolean = true): OmniAPIKey[] {
    // Get the security schemes from the API spec
    const securitySchemes: OmniAPIAuthenticationScheme[] = [];
    const components = this.getBlocksForNamespace(namespace);
    if (components != null) {
      components.forEach((component) => {
        if (component.security != null) {
          securitySchemes.push(...component.security);
        }
      });
    }
    if (securitySchemes.length <= 0) {
      return []; // `No security schemes found for namespace ${namespace}`
    }

    const requiredCredentials: OmniAPIKey[] = [];
    // For each security scheme, parse the required credentials
    for (const scheme of securitySchemes) {
      if (!includeOptional && scheme.isOptional) {
        continue;
      }

      scheme.requireKeys?.forEach((key: OmniAPIKey) => {
        const existing = requiredCredentials.find((k) => k.id === key.id);
        if (!existing) {
          requiredCredentials.push(key);
        }
      });
    }

    return Array.from(requiredCredentials);
  }

  async getSecurityScheme(apiNamespace: string, version?: string): Promise<OmniAPIAuthenticationScheme[]> {
    // Get the security schemes from the API spec
    const securitySchemes: OmniAPIAuthenticationScheme[] = [];
    const components = this.getBlocksForNamespace(apiNamespace);
    if (components != null) {
      components.forEach((component) => {
        if (component.security != null) {
          securitySchemes.push(...component.security);
        }
      });
    }

    return securitySchemes;
  }

  async searchSecurityScheme(apiNamespace: string, version?: string, schemeType?: string, oauthFlowType?: string) {
    const securitySchemes = await this.getSecurityScheme(apiNamespace, version);
    const filteredSecuritySchemes = securitySchemes.filter((securityScheme) => {
      if (schemeType != null) {
        // Filter by the scheme type
        if (securityScheme.type !== schemeType) {
          return false;
        }

        // Filter by the oauth flow type
        if (schemeType === 'oauth2' && oauthFlowType != null) {
          if (Object.hasOwnProperty.call(securityScheme.oauth, oauthFlowType)) {
            return true;
          } else {
            return false;
          }
        }
      }

      return true;
    });
    return filteredSecuritySchemes;
  }

  public getAPISignature(namespace: string, operationId: string) {
    const ns = this.getNamespace(namespace);
    if (!ns) {
      throw new Error(`Namespace ${namespace} not found`);
    }

    const component = this.getBlock(`${namespace}.${operationId}`);
    if (!component) {
      throw new Error(`BlockManager: Component ${operationId} not found`);
    }

    const signature = {
      method: component.method,
      url: ns.api?.basePath + component.urlPath,
      contentType: component.responseContentType,
      requestContentType: component.requestContentType,
      security: component.security
    };
    this.debug(`getAPISignature ${namespace} ${operationId} ${JSON.stringify(signature, null, 2)}`);
    return signature;
  }

  public async runBlock(
    ctx: WorkerContext,
    blockName: string,
    args: any,
    outputs?: any,
    opts?: {
      cacheType?: 'global' | 'user' | 'session';
      cacheKey?: string;
      cacheTTLInSeconds?: number;
      bustCache?: false;
      timeout?: number;
    }
  ) {
    opts ??= {};

    this.info('runblock', blockName, args, outputs, opts);

    if (!ctx.sessionId) {
      this.error('Invalid session');
      return { error: 'Invalid session' };
    }

    const block = await this.getInstance(blockName);
    this.info(`Running block ${blockName}`);
    if (!block) {
      this.error('Invalid block', blockName);
      return { error: 'Invalid block' };
    }

    const inputs: Record<string, any> = {};

    for (const key in args) {
      if (args[key] !== null && args[key] !== undefined) {
        inputs[key] = Array.isArray(args[key]) ? args[key] : [args[key]];
      }
    }

    outputs ??= { text: '' };

    const node = {
      id: 1,
      name: blockName,
      type: 'component',
      component: blockName,
      inputs,
      outputs,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      data: {} as NodeData,
      position: [0, 0] as [number, number]
    };

    const workerContext = WorkerContext.create(ctx.app, null, node, {
      ...ctx.getData()
    });

    let cKey = '';
    const ttl = (opts.cacheTTLInSeconds ? opts.cacheTTLInSeconds * 1000 : 60 * 60 * 24 * 1000) + Date.now();
    if (opts?.cacheType) {
      const hashState = new MurmurHash3();
      if (opts.cacheType === 'session') {
        cKey = ctx.sessionId;
      } else if (opts.cacheType === 'global') {
        cKey = 'global';
      } else if (opts.cacheType === 'user') {
        cKey = ctx.userId;
      }
      const hash = hashState.hash(JSON.stringify(inputs)).result().toString(16);
      cKey = cKey + ':' + blockName + ':' + block.hash + hash;
    }

    if (opts?.bustCache) {
      this.info('Busting cache for ' + cKey);
      this.cache.delete(cKey);
    } else if (cKey.length && this.cache.get(cKey)) {
      this.info('Cache hit for ' + cKey);
      return this.cache.get(cKey);
    }

    let result = (await block.workerStart(inputs, workerContext)) as any;

    // Let's throw on errors
    if (!result || result.error) {
      if (!result) {
        result = { error: 'Unknown error' };
      }
      this.error('Error running block', result.error);
      return result;
    }

    if (cKey.length) {
      this.info('Cache miss for ' + cKey);
      this.cache.set(cKey, result, ttl);
    }

    return result;
  }
}

export { BlockManager };
