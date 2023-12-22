/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { execSync } from 'child_process';
import { ensureDir } from 'fs-extra';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import fetch from 'node-fetch';
import { OAIComponent31, type OmniComponentFormat, type OmniComponentPatch } from 'omni-sockets';
import { ExtensionManager, omnilog, type IExtensionConfig } from 'omni-shared';
import path from 'path';
import { performance } from 'perf_hooks';
import serialize from 'serialize-javascript';
import { simpleGit } from 'simple-git';
import { validateDirectoryExists, validateFileExists } from '../helper/validation.js';
import type MercsServer from './Server.js';
import { ServerExtension } from './ServerExtension.js';
import { ExtensionUtils, type IExtensionYaml, type IKnownExtensionsManifest, type IKnownExtensionsManifestEntry } from './ServerExtensionUtils.js';

// For how many MS to cache extension details before refetchign them
const EXTENSION_UPDATE_AFTER_MS = 1000 * 60 * 60 * 24;

// Use this enum to export available events to extensions
export enum PERMITTED_EXTENSIONS_EVENTS {
  'pre_request_execute' = 'pre_request_execute',
  'post_request_execute' = 'post_request_execute',
  'component:x-input' = 'component:x-input', // (payload)
  'jobs.job_started' = 'job_started',
  'jobs.job_finished' = 'job_finished',
  'jobs.pre_workflow_start' = 'job_pre_start', // (workflow, ctx, actions)
  'session_created' = 'session_created', // (session_id, user)
  'blocks.block_added' = 'block_added',  // (block / error)
}

export enum KNOWN_EXTENSION_METHODS {
  'resolveMissingBlock' = 'resolveMissingBlock' // install a missing bloc
}

class ServerExtensionManager extends ExtensionManager {
  constructor(app: MercsServer) {
    super(app);
  }

  get extensions(): Map<string, ServerExtension> {
    return this.children as Map<string, ServerExtension>;
  }

  has(id: string): boolean {
    return this.extensions.has(id);
  }

  get(id: string): ServerExtension | undefined {
    return this.extensions.get(id);
  }

  all(): ServerExtension[] {
    return Array.from(this.extensions.values());
  }

  register(Ctor: any, config: any, wrapper?: any) {
    this.debug(`registering ${config.id} extensions`);
    let extension = new Ctor(config.id, this, config);
    if (wrapper && typeof wrapper === 'function') {
      extension = wrapper(extension);
    }
    this.children.set(config.id, extension);
    extension.create?.();
    return extension;
  }

  onRegisterStatics(args: { fastifyInstance: any; fastifyStatic: any }) {
    this.extensions.forEach((extension: ServerExtension) => {
      extension.onRegisterStatic(args);
    });
  }

  async runExtensionEvent(event: PERMITTED_EXTENSIONS_EVENTS, data: any) {
    this.debug('runExtensionEvent', event);

    for (const extension of this.extensions.values()) {
      if (!extension.disabled && extension.hasEventHook(event)) {
        const ctx = {
          app: this.app,
          extension
        };
        try {
          await extension.invokeEventHook(ctx, event, data);
        } catch (ex) {
          this.error('Error running extension event', extension.id, event, ex);
        }
      }
    }
  }

  installPackage(packageName: string): void {
    const installed = (this.app as MercsServer).kvStorage?.get('extensions.installed_deps') || [];
    if (installed.includes(packageName)) {
      this.info('Package already installed:', packageName);
      return;
    }

    packageName = packageName.replace(/[^a-zA-Z0-9-_@]/g, '');

    try {
      omnilog.log(execSync(`yarn add ${packageName}`).toString());
    } catch (ex) {
      this.error('Error installing package', packageName, ex);
    }

    installed.push(packageName);

    omnilog.log(this.app);

    // @ts-ignore
    this.app.kvStorage.set('extensions.installed_deps', installed);
  }

  async stop(): Promise<boolean> {
    this.debug('Stopping extensions');

    // remove event subscriptions

    Object.entries(PERMITTED_EXTENSIONS_EVENTS).forEach(([appEvent, extensionEvent]) => {
      this.app.events.off(appEvent, (data: any) => {
        void this.runExtensionEvent(extensionEvent, data);
      });
    });

    for (const extension of this.extensions.values()) {
      await extension.stop?.();
    }
    return true;
  }

  async init(): Promise<void> {
    const loadStart = performance.now();
    const self = this;
    const mercsServer = this.app as MercsServer;
    const blockManager = mercsServer.blocks;

    if (!(await validateDirectoryExists(path.join(process.cwd(), 'extensions')))) {
      await ensureDir(path.join(process.cwd(), 'extensions'));
    }

    const apisLocalPath = this.app.config.settings.paths?.apisLocalPath || 'data.local/apis-local';
    const localDir = path.join(process.cwd(), apisLocalPath)
    if (!(await validateDirectoryExists(localDir))) {
      await ensureDir(path.join(process.cwd(), 'data.local', 'apis-local'));
    }

    mercsServer.subscribeToServiceEvent('httpd', 'onRegisterStatics', this.onRegisterStatics.bind(this));

    // scan /extensions folder for extension subdirectories containing an extension.yaml file
    const extensions = await fs.readdir(path.join(process.cwd(), 'extensions'));
    for (const extension of extensions) {
      const start = performance.now();

      const extensionPath = path.join(process.cwd(), 'extensions', extension);
      const extensionConfigPath = path.join(extensionPath, 'extension.yaml');
      const clientScripts: Record<string, string> = {};
      const serverScripts: Record<string, string> = {};

      if (await validateFileExists(extensionConfigPath)) {
        if (await validateFileExists(path.join(extensionPath, '.disabled'))) {
          this.info('Skipping disabled extension', extension);
          continue;
        }

        if (mercsServer.options.noExtensions && !extension.includes('-core-')) {
          this.info(`Skipping non-core extension "${extension}" because --noExtensions was passed`);
          continue;
        }

        this.info(`Loading extension "${extension}"...`);
        const extensionYaml: any = await yaml.load(await fs.readFile(extensionConfigPath, 'utf-8'));

        // client script
        if (await validateDirectoryExists(path.join(extensionPath, 'scripts'))) {
          if (await validateDirectoryExists(path.join(extensionPath, 'scripts', 'client'))) {
            this.info('Registering client scripts for', extension);
            const clientScriptSources = await fs.readdir(path.join(extensionPath, 'scripts', 'client'));
            for (const clientScript of clientScriptSources) {
              const clientScriptPath = path.join(extensionPath, 'scripts', 'client', clientScript);
              // serialize the script
              if (await validateFileExists(clientScriptPath)) {
                this.info('Registering client script', clientScriptPath);
                const scriptId = path.basename(clientScriptPath, path.extname(clientScriptPath));
                clientScripts[scriptId] = serialize(await fs.readFile(clientScriptPath, 'utf-8'));
              }
            }
          }
        }

        // server scripts
        if (await validateDirectoryExists(path.join(extensionPath, 'scripts', 'server'))) {
          this.info('Registering server scripts for', extension);
          const serverScriptSources = await fs.readdir(path.join(extensionPath, 'scripts', 'server'));
          for (const serverScript of serverScriptSources) {
            const serverScriptPath = path.join(extensionPath, 'scripts', 'server', serverScript);
            // serialize the script
            if (await validateFileExists(serverScriptPath)) {
              this.info('Registering server script', serverScriptPath);
              const scriptId = path.basename(serverScriptPath, path.extname(serverScriptPath));
              serverScripts[scriptId] = serverScriptPath;
            }
          }
        }

        if (extensionYaml.dependencies != null) {
          this.info('Installing dependencies', extensionYaml.dependencies);

          for (const dep of Object.values(extensionYaml.dependencies as Record<string, string>)) {
            this.info('Installing dependency', dep);
            self.installPackage.bind(self)(dep);
          }
        }

        let hooks = null;
        let methods = null;
        // eslint-disable-next-line @typescript-eslint/ban-types
        let initExt: Function;
        // eslint-disable-next-line @typescript-eslint/ban-types
        let createComponents: Function | null = null;
        const blocks: OmniComponentFormat[] = [];
        const patches: OmniComponentPatch[] = [];
        const errors = [];

        if (await validateDirectoryExists(path.join(extensionPath, 'server'))) {
          let extFile = path.join(extensionPath, 'server', 'extension.cjs');
          if (!await validateFileExists(extFile)) {
            extFile = path.join(extensionPath, 'server', 'extension.js');
          }
          if (await validateFileExists(extFile)) {
            let loadedScript;
            try {
              const { heapUsed, heapTotal } = process.memoryUsage();
              loadedScript = (await import(`file://${extFile}`)).default;
              const { heapUsed: heapUsed2, heapTotal: heapTotal2 } = process.memoryUsage();
              this.info(
                'Loaded extension.js for',
                extension,
                'in',
                (heapUsed2 - heapUsed).toFixed(),
                'bytes',
                (heapTotal2 - heapTotal).toFixed(),
                'bytes total'
              );
            } catch (ex: any) {
              errors.push(ex.message);
              this.error('Error loading extension.js for', extension, ex);
            }

            if (loadedScript != null) {
              this.debug('Loaded extension.js for', extension);
              // Initialize extension
              initExt = loadedScript.init;
              if (initExt) {
                this.debug('Initializing extension', extension);
                try {
                  await initExt({ app: this.app });
                } catch (ex: any) {
                  errors.push(ex.message);
                  this.error('Error initializing extension', extension, ex);
                }
              }

              hooks = loadedScript.extensionHooks;
              this.verbose('Loaded event hooks for', extension, Object.keys(loadedScript.extensionHooks || []));

              if (loadedScript.extensionMethods != null && typeof loadedScript.extensionMethods === 'object') {
                methods = loadedScript.extensionMethods;
                this.verbose('Loaded methods hooks for', extension, Object.keys(loadedScript.extensionMethods || []));
              }

              if (loadedScript.createComponents != null) {
                // only load createComponents if compatible with the new system
                if (extensionYaml.supports?.includes?.('blocks:v2')) {
                  createComponents = loadedScript.createComponents;
                  this.verbose('Loaded createComponents function for', extension, createComponents);
                } else {
                  this.warn(
                    'Skipping createComponents for',
                    extension,
                    'because extension.yaml does not indicate supports.[blocks:v2] property',
                    extensionYaml
                  );
                }
              }
              if (createComponents) {
                const DecorateBlocks = (block: OmniComponentFormat) => {
                  block.origin = 'extension:' + extension;
                  block.apiNamespace = block.displayNamespace = extension + ':' + block.displayNamespace;
                  return block;
                };

                const DecoratePatches = (patch: OmniComponentPatch) => {
                  patch.origin = 'extension:' + extension;
                  patch.displayNamespace = extension + ':' + patch.displayNamespace;
                  return patch;
                };

                let results;
                try {
                  //results  = createComponents?.(OAIComponent31)
                  // Call createComponents, which may be sync or async
                  const potentialPromise = createComponents?.(OAIComponent31);

                  // Check if the result is a Promise (i.e., if createComponents is an async function)
                  if (potentialPromise instanceof Promise) {
                    // If it's a Promise, await it
                    omnilog.log('Found an async component creation. Awaiting it.');
                    results = await potentialPromise;
                  } else {
                    // If it's not a Promise, just use the result directly
                    results = potentialPromise;
                  }
                } catch (ex: any) {
                  errors.push(ex.message);
                  this.error('Failed to create components for extension, skipping', extension, ex);
                }
                if (results) {
                  let { blocks, patches, macros } = results;

                  if (blocks) blocks = blocks.map(DecorateBlocks);
                  if (patches) patches = patches.map(DecoratePatches);
                  if (macros) await this.app.emit('register_macros', macros);
                  if (blocks) await this.app.emit('register_blocks', blocks);
                  if (patches) await this.app.emit('register_patches', patches);

                  this.success(
                    `Registered ${blocks.length} blocks for`,
                    extension,
                    Object.values(blocks).map((c: any) => c.displayOperationId)
                  );
                  this.success(
                    `Registered ${patches.length} blocks for`,
                    extension,
                    Object.values(patches).map((c: any) => c.displayOperationId)
                  );
                }
              }
            }
          }
        }

        const extensionConfig = Object.assign(
          { id: extension },
          extensionYaml,
          { path: extensionPath },
          {
            scripts: { client: clientScripts, server: serverScripts },
            server: { hooks, methods },
            blocks: blocks.map((b) => blockManager.formatHeader(b)),
            patches: patches.map((p) => blockManager.formatHeader(p)),
            errors
          }
        );
        this.register(ServerExtension, extensionConfig);
      }
      const end = performance.now();

      // Force a refresh of the extensions manifest list
      await this.getExtensionsList(this.server.options.updateExtensions);
      // unset the dirty flag
      this.server.kvStorage?.del('extensions.dirty');
      this.success('Loaded extension', extension, 'in', (end - start).toFixed(), 'ms');
    }

    Object.entries(PERMITTED_EXTENSIONS_EVENTS).forEach(([appEvent, extensionEvent]) => {
      this.app.events.on(appEvent, async (data: any) => {
        await this.runExtensionEvent(extensionEvent, data || {});
      });
    });

    await this.app.emit('extensions_loaded', this.app);

    const loadEnd = performance.now();
    this.success('Loaded', this.extensions.size, 'extensions in', (loadEnd - loadStart).toFixed(), 'ms');
  }

  static async getCoreExtensions(): Promise<IKnownExtensionsManifest['core_extensions']> {
    const knownExtensionsPath = path.join(process.cwd(), 'config.default', 'extensions', 'known_extensions.yaml');

    // validate the file exists
    if (!(await validateFileExists(knownExtensionsPath))) {
      throw new Error(`Unable to find known extensions manifest at ${knownExtensionsPath}`);
    }
    const knownExtensions = (await yaml.load(
      await fs.readFile(knownExtensionsPath, 'utf-8')
    )) as IKnownExtensionsManifest;

    // find all core extensions from known_extensions.yaml > core_extensions:
    return knownExtensions.core_extensions;
  }

  async getExtensionsList(bustCache: boolean): Promise<IKnownExtensionsManifestEntry[]> {
    const knownExtensionsPath = path.join(process.cwd(), 'config.default', 'extensions', 'known_extensions.yaml');

    // If we are not busting cache, not updating extensions and extensions are not dirty, return the cached version
    if (!bustCache && !this.server.options.updateExtensions && !this.server.kvStorage?.get('extensions.dirty')) {
      let manifest: IKnownExtensionsManifestEntry[] = [];
      manifest = (this.server.kvStorage?.get('extensions.manifest') as IKnownExtensionsManifestEntry[]) || [];

      if (manifest?.length > 0) {
        // But even with the cached version, we update the installed status
        manifest = manifest.map((extension: any) => {
          return {
            ...extension,
            installed: this.extensions.has(extension.id)
          };
        });
        return manifest;
      }
    }

    // validate the file exists
    if (!(await validateFileExists(knownExtensionsPath))) {
      throw new Error(`Unable to find known extensions manifest at ${knownExtensionsPath}`);
    }

    const knownExtensions = await ExtensionUtils.loadCombinedManifest(knownExtensionsPath);

    if (knownExtensions.core_extensions === undefined) {
      throw new Error(`Unable to find core extensions manifest at ${knownExtensionsPath}`);
    }

    let ret = knownExtensions.core_extensions.map((extension: any) => {
      // Extension ids are alphanumeric
      const extensionId = extension.id.replace(/[^a-zA-Z0-9-_]/g, '_');
      return {
        ...extension,
        id: extensionId,
        isCore: false,
        isLocal: false,
        installed: this.extensions.has(extensionId)
      };
    });
    knownExtensions.known_extensions = knownExtensions.known_extensions ?? [];
    ret = ret.concat(
      knownExtensions.known_extensions.map((extension: any) => {
        // Extension ids are alphanumeric
        const extensionId = extension.id.replace(/[^a-zA-Z0-9-_]/g, '_');
        return {
          ...extension,
          id: extensionId,
          isCore: true,
          isLocal: false,
          installed: this.extensions.has(extensionId)
        };
      })
    );

    // Find local extensions (not in known_extensions.yaml)
    const localExtensions = Array.from(this.extensions.keys())
      .filter((extensionId: string) => !ret.find((e: any) => e.id === extensionId))
      .map((extensionId: string) => {
        return {
          id: extensionId,
          isCore: false, // local can never be core
          isLocal: true,
          installed: true
        };
      });

    if (localExtensions.length > 0) {
      ret = ret.concat(localExtensions);
    }

    ret = await Promise.all(
      ret.map(async (extension: any) => {
        // for installed extensions, we take the manifest from the extension managers
        if (extension.installed) {
          extension.manifest = (this.extensions.get(extension.id) as ServerExtension).extensionConfig;
        } // for others, we fetch the manifest from the repo
        else if (extension.url){
          try {
            const result = await fetch(extension.url);
            if (!result.ok) {
              extension.error = `Unable to fetch manifest for extension from ${extension.url}`;
            } else {
              const manifestText = await result.text();
              const manifest = (await yaml.load(manifestText)) as IExtensionYaml;
              extension.manifest = manifest;
            }
          } catch (ex: any) {
            extension.error = ex.message;
          }
        }
        return extension;
      })
    );

    ret = ret.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));

    this.server.kvStorage?.set('extensions.manifest', ret, Date.now() + EXTENSION_UPDATE_AFTER_MS);

    // find all core extensions from known_extensions.yaml > core_extensions:
    return ret;
  }

  get server(): MercsServer {
    return this.app as MercsServer;
  }

  // Ensure core extensions exist and are on the latest version
  static async ensureCoreExtensions(extensionDir: string, sdkVersion: string) {
    try {
      // Ensure the extensions directory exists
      await ensureDir(extensionDir);

      const coreExtensions = await ServerExtensionManager.getCoreExtensions();

      if (coreExtensions === undefined) {
        throw new Error(`Unable to load core extension manifest.`);
      }

      // for each core extension, check if it exists in the extensions directory
      await Promise.all(
        coreExtensions.map(async (extension) => {
          if (!extension.url) {
            omnilog.warn(`⚠️  Failed to install ${extension.id}:  No repository url available. Skipping.`);
            return;
          }

          // @ts-ignore (fetch is actually available in node 20 but it complains)
          const manifestFile = await fetch(extension.url)
          const manifestText = await manifestFile.text();
          const manifest = (await yaml.load(manifestText)) as IExtensionYaml;
          // Extension ids are alphanumeric
          const extensionId = extension.id.replace(/[^a-zA-Z0-9-_]/g, '_');
          const extensionPath = path.join(extensionDir, extensionId);

          if (await validateDirectoryExists(extensionPath)) {
            omnilog.info('☑️  Extension', extensionId, '... ok, updating....');

            const git = simpleGit(extensionPath);
            try {
              const statusResult = await git.status();
              if (!statusResult.isClean()) {
                omnilog.warn(
                  `Local changes detected in the ${extensionId} repo.\nPlease reconcile manually or reset by deleting the folder.`
                );
                if (await ExtensionUtils.validateLocalChanges(extensionDir, extensionId)) {
                  omnilog.status_success(`Local changes validated on ${extensionId}`);
                }
              } else {
                const result = await ExtensionUtils.updateToLatestCompatibleVersion(extensionId, manifest, extensionPath, sdkVersion);
                const statusString = result.didUpdate ? `updated to ${result.currentHash}` : `up-to-date at ${result.currentHash}`;
                omnilog.status_success(`Extension ${extensionId}...${statusString}`);
              }
            } catch (ex) {
              omnilog.warn(`Unable to update core extension ${extensionId}: ${ex}. This may cause problems.`);
            }
            return;
          }

          omnilog.info('Extension', extensionId, '... missing.');

          if (!extension.url) {
            omnilog.warn(`⚠️  Failed to install ${extensionId}:  No repository url available. Skipping.`);
            return;
          }

          try {
            if (!manifest?.origin?.endsWith('.git')) {
              throw new Error('Manifest does not have a valid origin repository.');
            }

            omnilog.log(`⌛  Cloning extension ${extensionId}...`);

            try {
              // if it doesn't exist, clone it from the git repo specified in known_extensions.yaml
              await ExtensionUtils.installExtension(extensionId, manifest, extensionPath, sdkVersion);
            } catch (ex) {
              omnilog.warn(`⚠️  Unable to clone from ${manifest.origin}: ${ex}.`);
            }
          } catch (ex: any) {
            omnilog.warn(`⚠️  Failed to install ${extensionId}: ${ex.message}.`);
            return;
          }

          omnilog.status_success(`${extensionId} was successfully installed. `);
        })
      );
    } catch (ex) {
      omnilog.warn(`⚠️ Unable to validate core extensions: ${ex}.\n The product may be missing core functionality.`);
    }

    omnilog.status_success('Core extensions validated.');
  }

  static async pruneExtensions(extensionDir: string) {
    const extensionDirs = await fs.readdir(extensionDir);
    for (const extension of extensionDirs) {
      const extensionPath = path.join(extensionDir, extension);
      if (!(await validateDirectoryExists(path.join(extensionPath, '.git')))) {
        continue;
      }
      const manifestFile = path.join(extensionPath, 'extension.yaml');

      if (!(await validateFileExists(manifestFile))) {
        continue;
      }

      const extensionYaml: any = await yaml.load(await fs.readFile(manifestFile, 'utf-8'));

      if (!extensionYaml.deprecated) {
        continue;
      }

      omnilog.info(`  ${extension} is deprecated. ${extensionYaml.deprecationReason}.\nPruning...`);
      await fs.rmdir(extensionPath, { recursive: true });

      omnilog.info(`☑️  ${extension} was successfully pruned. `);
    }
  }

  static async updateExtensions(
    extensionDir: string,
    sdkVersion: string,
    options: { updateExtensions?: boolean; pruneExtensions?: boolean }
  ) {
    // For each directory in the extensions directory, check if it's a git repo and if so, pull the latest changes
    const extensionDirs = await fs.readdir(extensionDir);
    await Promise.all(
      extensionDirs.map(async (extension) => {
        if (extension.startsWith('.')) {
          // Hidden folder or system file, skip
          return;
        }
        if (!options.updateExtensions || extension.includes('-core-')) {
          return;
        }

        const extensionPath = path.join(extensionDir, extension);
        if (!(await validateDirectoryExists(path.join(extensionPath, '.git')))) {
          omnilog.warn(`⚠️ ${extension} not updated: Not a valid git repository`);
          return;
        }
        const manifestFile = path.join(extensionPath, 'extension.yaml');

        if (!(await validateFileExists(manifestFile))) {
          omnilog.warn(
            `⚠️ ${extension} folder does not have a valid manifest file, update cancelled. To fix, delete ${extensionPath} and reinstall the extension.`
          );
          return;
        }

        const extensionYaml: any = await yaml.load(await fs.readFile(manifestFile, 'utf-8'));

        if (extensionYaml.deprecated) {
          omnilog.warn(
            `⚠️ ${extension} is deprecated. ${extensionYaml.deprecationReason}. \nYou can use --pruneExtensions to remove it.`
          );
          return;
        }

        omnilog.log(`Updating extension ${extension}...`);
        const git = simpleGit(extensionPath);
        try {
          const statusResult = await git.status();
          if (!statusResult.isClean()) {
            omnilog.warn(
              `Local changes detected in the ${extension} repo.\nPlease reconcile manually or reset by deleting the folder.`
            );
            if (await ExtensionUtils.validateLocalChanges(extensionDir, extension)) {
              omnilog.status_success(`Local changes validated on ${extension}`);
            }
          }
          else {
            const result = await ExtensionUtils.updateToLatestCompatibleVersion(extension, extensionYaml, extensionPath, sdkVersion);
            const statusString = result.didUpdate ? `updated to ${result.currentHash}` : `up-to-date at ${result.currentHash}`;
            omnilog.status_success(`Extension ${extension}...${statusString}`);
          }
        } catch (ex) {
          omnilog.warn(`Unable to update extension ${extension}: ${ex}`);
        }
      })
    );
  }
}

export { ServerExtension, ServerExtensionManager, type IExtensionConfig };
