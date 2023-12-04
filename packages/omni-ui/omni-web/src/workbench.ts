/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import '@winbox/src/css/winbox.css';
import axios from 'axios';
import { type ClientExtension } from 'omni-client-services';
import { JOBSTATE, omnilog, type Job, Utils } from 'omni-shared';
import ClientWorkflow from './classes/ClientWorkflow';
import { type OmnitoolClient } from './client';
import sanitize from 'sanitize-filename';

class Workbench {
  _activeRecipe: ClientWorkflow | null = null;
  nicknames: Record<string, string> = {};

  _activeExtension?: ClientExtension;
  showFloatingExtension: boolean = false;
  floatingExtensionX: number = window.screen.width / 2;
  floatingExtensionY: number = window.screen.height / 2;

  refreshTS = Date.now();
  isLoading = false;

  get activeExtension() {
    return this._activeExtension;
  }

  hideExtension() {
    this._activeExtension = undefined;
  }

  showExtension(
    id: string,
    args: any,
    page: string = '',
    opts?: {
      displayMode?: string;
      floatingHeight?: number;
      floatingWidth?: number;
      winbox?: any;
      singletonHash?: string;
      hideToolbar?: boolean;
    }
  ) {
    opts ??= {};

    if (page.length > 0 && !page.endsWith('.html')) {
      page = page + '.html';
    }

    const ext = this.getClient().extensions.get(id);

    if (!ext) {
      return;
    }

    this._activeExtension = ext;
    // @ts-ignore
    const mode = (opts.displayMode ?? ext?.extensionConfig?.displayMode) || 'default';

    let url = '';
    const ts = Date.now();
    if (typeof args === 'string') {
      // args is a fully formed and encoded string
      url = `/extensions/${id}/${page}?${args}&ts=${ts}&o=${encodeURIComponent(
        JSON.stringify({ mode, hideToolbar: opts.hideToolbar })
      )}`;
    } else if (!args || typeof args === 'object') {
      args ??= {};
      const query = 'q=' + encodeURIComponent(JSON.stringify(args));
      const o = 'o=' + encodeURIComponent(JSON.stringify({ mode, hideToolbar: opts.hideToolbar }));
      url = `/extensions/${id}/${page}?${query}&${o}`;

      omnilog.debug('rev', new URLSearchParams(url.toString()).toString());
    }

    const singletonHash = opts.singletonHash ?? (ext.singleton ? ext.id : undefined);
    const winboxOpts = Object.assign(
      {},
      {
        ...(ext.extensionConfig.winbox || { x: 'center', y: 'center' }),
        title: ext.extensionConfig.title || ext.id
      },
      opts.winbox || {}
    );

    // if winboxOpts.height or width is a string, parse it as a percentage of the screen size (dh, dw)
    const dh = window.screen.height;
    const dw = window.screen.width;
    if (typeof winboxOpts.height === 'string') {
      winboxOpts.height = parseInt(winboxOpts.height) / 100.0 * dh;
    }
    if (typeof winboxOpts.width === 'string') {
      winboxOpts.width = parseInt(winboxOpts.width) / 100.0 * dw;
    }


    const win = this.getClient().toggleWindow(url, singletonHash, winboxOpts);
    if (win) {
      win.show?.();
    }

    // @ts-ignore
    if (this.getClient().extensions.get(id)?.extensionConfig.minimizeChat) {
      this.getClient().uiSettings.toggleMinimized(true);
    }
  }

  refreshUI() {
    this.refreshTS = Date.now(); // Refresh UI if required
  }

  isSingletonActive(id: string): boolean {
    return !!this.getClient().getWindow(id);
  }

  getClient(): OmnitoolClient {
    return (window as Window & typeof globalThis & { client: OmnitoolClient }).client;
  }

  getExtensions() {
    return this.getClient().extensions.all();
  }

  get activeWorkflow(): ClientWorkflow | null {
    // Deprecated
    return this._activeRecipe;
  }

  get activeRecipe(): ClientWorkflow | null {
    return this._activeRecipe;
  }

  set activeRecipe(recipe: ClientWorkflow | null) {
    this._activeRecipe = recipe;
  }

  get activeRecipeId() {
    return this._activeRecipe?.id;
  }

  getMetaDataBlock(): any {
    if (!this.activeWorkflow) {
      return;
    }
    const metadata = Object.values(this.activeWorkflow.rete.nodes).find(
      (n: any) => n.name === 'omnitool.recipe_metadata'
    );
    return metadata;
  }

  updateMetaFromBlock() {
    if (!this.activeWorkflow) {
      return;
    }

    const metadata = this.getMetaDataBlock();
    if (!metadata) {
      return;
    }
    this.activeWorkflow.meta.name = metadata.data.title;
    this.activeWorkflow.meta.description = metadata.data.description;
    this.activeWorkflow.meta.author = metadata.data.author;
    this.activeWorkflow.meta.help = metadata.data.help;
  }

  private setDemoRecipe(name: string, id: string) {
    const record = this.getRecipeIdFromNickname(name);
    if (record && typeof record === 'object') {
      //return ... Just ignore previous binding for now ...
    }
    this.setNickname(name, id);
  }

  private async _load(): Promise<boolean> {
    this.updateNickNames();

    // Copied from omni-core-recipes/scripts/server/import.js
    this.setDemoRecipe('Bugbear', 'c0deba5e-417d-49df-96d3-8aeb8fc15402');

    const client = this.getClient();

    const pruneEmptyConnections = (item: any) => {
      for (const prop in item) {
        if (Array.isArray(item[prop].connections) && item[prop].connections.length === 0) {
          delete item[prop].connections;
        }
      }
    };

    const pruneRete = function (jsonObj: any) {
      for (const key in jsonObj) {
        ['inputs', 'controls', 'outputs'].forEach((property) => {
          if (Object.prototype.hasOwnProperty.call(jsonObj[key], property)) {
            pruneEmptyConnections(jsonObj[key][property]);
          }
        });
      }
      return jsonObj;
    };

    client.registerClientScript('explain', async (args: any) => {
      if (!this.activeWorkflow) {
        return;
      }
      const targetAudience = args[0] || 'beginner just learning omnitool and AI';
      const json = await this.activeWorkflow.toJSON();
      const rete = pruneRete(json.rete);

      await client.sendSystemMessage(
        `⌛ Analyzing the recipe to provide an explanation for a ${targetAudience}. Please wait...`
      );

      const name = json.meta.name;
      const pic = json.meta.pictureUrl;

      let instruction = `Acting as a smart, thoughtful, humble, and experienced teacher, given a Rete.js workflow, please explain using proper language and analogies for a ${targetAudience} what the purpose of the recipe this workflow represents is and how it operates.
Format your explanation using markdown.
Start with a Level 1 heading titled '${name}'.`;
      if (pic) {
        instruction += ` Add an image tag pointing to '/${pic}' below the heading.`;
      }

      instruction += ` Break the document into logical sections with Level 2 headings (Overview, Nodes Explanation, Recipe).
When referring to a "Rete Workflow", use the word "Recipe" instead.
When referring to a "Rete Node", use the word "Block" instead.
Explain the most critical and commonly misunderstood blocks in detail.
Do not include JSON notation or mention the JSON directly inside the markdown.
Remember that the user cannot see the node id numbers. The numbers for your use only. When referencing the blocks, use the block name, (or "x-omni-title") instead.
Close with a "Further Exploration" section that contains 1-2 bullet points with interesting aspects for the user to explore when looking to extend the recipe.`;

      // TODO: Add the mapping from block IDs to block names, e.g. {"omnitool.chat_output": "Chat Output"}

      const response = await client.runBlock({
        block: 'omnitool.large_language_model',
        args: {
          Instruction: instruction,
          Prompt: JSON.stringify(rete),
          Criteria: 'Accurate'
        }
      });
      if (!response?.Reply) {
        await client.sendSystemMessage('Apologies, there was a problem analyzing the recipe.');
        return;
      }

      let markdown = response.Reply;

      // Migrate from old names to new names
      markdown = markdown.replace(/node/gi, 'Block');
      markdown = markdown.replace(/workflow/gi, 'Recipe');

      this.showExtension('omni-core-viewers', { markdown }, 'markdown', { displayMode: 'floating' });
    });

    client.registerClientScript('save', async () => {
      if (!this.canSave) {
        return;
      }
      try {
        await this.save();
        return { response: 'Recipe saved.' };
      } catch (e: any) {
        await this.getClient().sendSystemMessage('Failed to save recipe' + e.message, 'text/plain', {}, ['error']);
        return { error: 'Failed to save' };
      }
    });

    client.registerClientScript('dump', async () => {
      if (this.activeRecipe == null) {
        return;
      }
      await this.syncToServer();
      // Create a link element
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = `/api/v1/workflow/download/${this.activeRecipe.id}`;
      document.body.appendChild(a);

      // Trigger the download
      a.click();

      // Clean up
      document.body.removeChild(a);
      return 'Recipe Exported';
    });

    client.registerClientScript('load', async (args: any) => {
      if (this.canSave) {
        await this.save();
      }

      if (args.length === 0) {
        return 'Loads a recipe. Usage: /load <url>';
      }

      const url = args[0];

      if (!Utils.isValidUrl(url)) {
        return 'Invalid URL';
      }

      const json = await Utils.fetchJSON(url);
      await this.loadFromJSON(json);

      return `Recipe loaded from  ${url}`;
    });

    client.registerClientScript('setname', async (args: string[]) => {
      const name = args[0];
      if (!name) {
        return {
          response:
            '**setname**  \nSets a nickname for the current recipe, allowing you to invoke it at any time by using **@nickname** in chat.  \nUsage: **/setname** <name> \n'
        };
      }

      // Clear old recipes for this nickname.
      this.deleteNickname(name);

      // Clear old names for this recipe.
      for (let i = 0; i < 10; i++) {
        const oldname = this.getNickname();
        if (!oldname) {
          break;
        }
        this.deleteNickname(oldname);
      }

      const result = this.setNickname(name);
      if (!result) {
        return { response: 'Failed to set nickname.' };
      }
      return {
        response: `Recipe nickname set to **${name}**. You can now start this recipe from any chat by using **@${name}** <text>.`
      };
    });

    client.registerClientScript('unsetname', async (args: string[]) => {
      if (args.length > 0) {
        const name = args[0];
        const result = this.deleteNickname(name);
        if (result) {
          return { response: 'Recipe nickname removed.' };
        }
      }
      return {
        response:
          '**unsetsetname**  \nRemoves a nickname for a recipe previously set with /setname.  \nUsage: **/unsetname** <name> \n'
      };
    });

    client.registerClientScript('toggleFavorite', async (args: string[]) => {
      if (args.length > 0) {
        const key = args[0];
        if (window.localStorage.getItem(key) !== null) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, new Date().getTime().toString());
        }
        return true;
      }
      return false;
    });

    return true;
  }

  async load(): Promise<boolean> {
    try {
      return await this._load();
    } catch (e) {
      // Should never happen in normal operation.
      alert(
        'An unexpected error occurred while loading the workbench.\n\nYou will experience further errors that cannot be fixed.\n\nPlease reload the app and try again.'
      );
    }
    return false;
  }

  get displayName() {
    const workflow = this.activeWorkflow;
    const nickname = this.getNickname();
    return workflow != null
      ? `${workflow.displayName} ${nickname ? '(@' + nickname + ')' : ''} `
      : 'Welcome to Omnitool.ai!';
  }

  get canEdit(): boolean {
    return !this.readOnly;
  }

  get canExecute(): boolean {
    return !!this.activeRecipe;
  }

  get canExport(): boolean {
    return !!this.activeRecipe;
  }

  get canFavorite(): boolean {
    return !!this.activeRecipe;
  }

  get canSave(): boolean {
    return !this.readOnly;
  }

  get canSaveAs(): boolean {
    return !!this.activeRecipe;
  }

  get isBlank(): boolean {
    return !this.activeWorkflow || this.activeWorkflow.isBlank;
  }

  get isFavorite(): boolean {
    return window.localStorage.getItem('fav-recipe' + this.activeRecipeId) !== null;
  }

  isRunningActiveWorkflow() {
    if (this.activeWorkflow != null) {
      const jobs = this.getClient().jobs.getJobsforWorkflow(this.activeWorkflow.id);
      return jobs.find((job: Job) => job.state === JOBSTATE.RUNNING);
    }
    return false;
  }

  get copyOnWrite(): boolean {
    return this.activeRecipe?.copyOnWrite ?? false;
  }

  get readOnly(): boolean {
    return this.activeWorkflow?.readOnly ?? true;
  }

  private getScopedKeyFromUserKey(userKey?: string): string {
    const key = userKey?.trim();
    if (!key) {
      return '';
    }

    // TODO: Inject current user context too.
    return `workbench:${key}`;
  }

  setWorkbenchSetting(key?: string, value?: string | object): boolean {
    if (typeof value === 'object') {
      value = JSON.stringify(value);
    }
    const scopedKey = this.getScopedKeyFromUserKey(key);
    if (!scopedKey) {
      omnilog.error('Invalid workbench setting key: ', key);
      return false;
    }
    if (!value) {
      const result = window.localStorage.getItem(scopedKey);
      window.localStorage.removeItem(scopedKey);
      omnilog.debug('Removed workbench setting: ', key);
      return !!result;
    }
    window.localStorage.setItem(scopedKey, value);
    omnilog.info('Set workbench setting: ', key);
    return true;
  }

  deleteWorkbenchSetting(key?: string): boolean {
    return this.setWorkbenchSetting(key, '');
  }

  getWorkbenchSetting(key: string) {
    const scopedKey = this.getScopedKeyFromUserKey(key);
    if (!scopedKey) {
      omnilog.error('Invalid workbench setting key: ', key);
      return;
    }
    const result = window.localStorage.getItem(scopedKey);
    try {
      return JSON.parse(result ?? '');
    } catch (e) {}
    return result;
  }

  getWorkbenchSettingKeys(prefix: string): string[] {
    const prefixedKeys: string[] = [];
    const fullPrefix = `workbench:${prefix}`;

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(fullPrefix)) {
        prefixedKeys.push(key.substring(fullPrefix.length));
      }
    }
    return prefixedKeys;
  }

  private getKeyFromNickname(nickname: string): string | undefined {
    const key = nickname
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return key ? `nicknames:${key}` : undefined;
  }

  deleteNickname(nickname: string): boolean {
    const key = this.getKeyFromNickname(nickname);
    return this.deleteWorkbenchSetting(key);
  }

  setNickname(nickname: string, id?: string): boolean {
    nickname = nickname.trim();
    id ??= this.activeWorkflow?.id;
    const key = this.getKeyFromNickname(nickname);
    if (!key) {
      return false;
    }
    const record = { nickname, id };
    const result = this.setWorkbenchSetting(key, record);
    this.updateNickNames();
    return result;
  }

  getNickname(id?: string): string | undefined {
    id ??= this.activeRecipe?.id;
    if (!id) {
      return undefined;
    }
    const keys = this.getWorkbenchSettingKeys('nicknames:');
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = this.getWorkbenchSetting(`nicknames:${key}`);
      if (value && value.id === id) {
        return value.nickname;
      }
    }

    return undefined;
  }

  updateNickNames() {
    const nicknameArray: any[] = [];

    const keys = this.getWorkbenchSettingKeys('nicknames:');
    keys.forEach((key) => {
      const value = this.getWorkbenchSetting(`nicknames:${key}`);
      if (value?.nickname) {
        // TODO run an HTML sanitizer on the nickname

        nicknameArray.push(value);
      }
    });

    nicknameArray.sort((a, b) => a.nickname.localeCompare(b.nickname));

    const sortedNicknames: Record<string, any> = {};
    nicknameArray.forEach((nicknameObj) => {
      sortedNicknames[nicknameObj.nickname] = nicknameObj;
    });

    this.nicknames = sortedNicknames;
  }

  async syncToServer() {
    if (!this.activeRecipe) {
      omnilog.error('workbench.syncToServer(): No active recipe');
      return false;
    }

    this.writeActiveRecipeIdToLocalStorage();

    if (!this.activeRecipe.isDirty) {
      // Not dirty, no reason to write.
      return true;
    }

    const result = await this.activeRecipe.syncToServer();
    this.writeActiveRecipeIdToLocalStorage(); // In case the id changed.
    return result;
  }

  async saveAs() {
    if (!this.activeWorkflow) {
      omnilog.error('saveAs(): No active recipe');
      return;
    }
    const recipe = this.activeWorkflow;

    let name = prompt('Recipe name:', recipe.meta.name || 'My Recipe');
    name = name ? name.trim() : null;
    if (!name) {
      return;
    }

    const metadata = this.getMetaDataBlock();
    if (metadata) {
      metadata.data.title = name;
    }
    recipe.meta.name = name;
    recipe.id = ''; // Force a new id
    recipe.readOnly = false;
    recipe.copyOnWrite = false;
    recipe.setDirty();
    await this.save();
  }

  async save() {
    if (!this.activeWorkflow) {
      omnilog.error('workbench.save(): No active recipe');
      return;
    }

    this.updateMetaFromBlock();

    let message = 'Saving recipe...';
    if (await this.syncToServer()) {
      message = `Recipe "${this.activeWorkflow.meta.name}" saved.`;
      await this.loadFromCache(false); // Reload any changes.
    } else {
      message = `Recipe "${this.activeWorkflow.meta.name}" (${this.activeWorkflow.id}) unable to save.`;
    }

    await this.getClient().sendSystemMessage(message);
  }

  async forceSave() {
    if (this.activeRecipe) {
      this.activeRecipe.setDirty();
    }
    await this.save();
  }

  getRecipeIdFromNickname(nickname: string): { nickname: string; id: string } | undefined {
    const key = this.getKeyFromNickname(nickname);
    return key ? this.getWorkbenchSetting(key) : undefined;
  }

  async executeByName(name: string, args: any) {
    if (name === 'omni') {
      // TODO: Temporary, refactor...
      const id = this.activeWorkflow?.id;
      return await this.executeById(id, args);
    }
    const record = this.getRecipeIdFromNickname(name);
    if (!record) {
      await this.getClient().sendSystemMessage(`There is no recipe by the name of "*${name}*"!`);
      return;
    }
    args.xOmniNickName = name;
    return await this.executeById(record.id, args);
  }

  async executeById(
    id: string | undefined,
    args: any
  ): Promise<{ status: string; jobId: string; sender: string } | null> {
    omnilog.debug('workbench.executeById', id, args);

    // If we are executing the **active** recipe by id, make sure it is synced to the server
    if (this.activeWorkflow?.id === id) {
      if (!this.readOnly) {
        // e.g. a public workflow
        if (!(await this.syncToServer())) {
          // May change `this.activeWorkflow.id`.
          // TODO: Error??

          return null;
        }
      }
      id = this.activeWorkflow?.id; // In case the `id` changed when we synced the recipe.
    }

    if (!id) {
      throw new Error(`Invalid recipe id: ${id} Cannot execute.`);
    }

    const client = this.getClient();
    args = JSON.parse(JSON.stringify(Object.assign({}, client.clipboard, args)));
    client.clipboard = {};
    const payload = { workflow: id, args };
    const result = await axios.post('/api/v1/workflow/exec', payload, {
      withCredentials: true
    });

    return result.data.result as {
      status: string;
      jobId: string;
      sender: string;
    };
  }

  async execute(args: any = {}) {
    if (this.activeWorkflow == null) {
      omnilog.error(`execute(${args}): No active workflow`);
      return;
    }

    this.writeActiveRecipeIdToLocalStorage();
    return await this.executeById(this.activeWorkflow.id, args);
  }

  async loadFromCache(fitToWindow = true) {
    const id = window.localStorage.getItem('active_recipe_id');
    await this.loadRecipe(id, fitToWindow);
  }

  async remixRecipe(): Promise<ClientWorkflow | null> {
    const recipe = this.activeWorkflow;
    if (!recipe) {
      throw new Error('Cannot remix empty recipe');
    }
    if (!recipe.id) {
      // Recipe does not exist on server. Perhaps call this.save() first?
      throw new Error('Cannot remix unsaved recipe');
    }

    let newName = prompt('Recipe name:', `My ${recipe.meta.name}`);
    newName = newName ? newName.trim() : null;

    if (!newName) {
      return null;
    }
    const meta = JSON.parse(JSON.stringify(recipe.meta));
    meta.name = newName; // Overwrite name.

    // Remove template flag and tag
    delete meta.template;
    if (meta.tags && Array.isArray(meta.tags)) {
      meta.tags = meta.tags.filter((tag: string) => tag !== 'template' && tag !== '#template');
    }

    const remix = await ClientWorkflow.clone({
      id: recipe.id,
      meta
    });
    if (!remix) {
      // ClientWorkflow.clone should throw errors, but just in case...
      return null;
    }
    await this.loadRecipe(remix.id); // Reload from server
    return this.activeWorkflow;
  }

  async newRecipe(name: string | null = '') {
    if (!name) {
      name = prompt('Name for new recipe:', 'My Recipe');
      name = name ? name.trim() : null;
    }

    if (!name) {
      return; // User cancelled
    }

    await this.loadFromJSON({});

    // And add a "MetaData" block by default.
    await this.getClient().runScript('add', ['omnitool.recipe_metadata'], { fromChatWindow: false });

    const metadata = this.getMetaDataBlock();
    if (metadata) {
      metadata.data.title = name;
      this.updateMetaFromBlock();
    }

    this.activeRecipe?.setDirty(); // Ensure save
    await this.syncToServer(); // Server side processing.
    await this.loadFromCache(); // Reload from server.

    const message = this.activeRecipe
      ? `Recipe "${this.activeRecipe.meta.name}" created.`
      : 'Failed to create a new recipe.';
    await this.getClient().sendSystemMessage(message);
  }

  async loadFromJSON(json: any, flags?: string[], fitToWindow = true): Promise<void> {
    this.activeRecipe = null;
    this.isLoading = true;
    this.activeRecipe = ClientWorkflow.fromJSON(json, flags);
    this.writeActiveRecipeIdToLocalStorage();

    const convertReadOnlyTemplateRecipesToCopyOnWriteRecipes = true;

    if (this.activeRecipe.readOnly && convertReadOnlyTemplateRecipesToCopyOnWriteRecipes) {
      this.activeRecipe.copyOnWrite = this.activeRecipe.readOnly;
      this.activeRecipe.readOnly = false;
    }

    // Emitting `workbench_workflow_loaded` will change `this.activeWorkflow.rete` to the alpine version
    await this.getClient().emit('workbench_workflow_loaded', this.activeRecipe?.id);

    this.showRecipeHelp();
    if (fitToWindow) {
      await this.getClient().runScript('fit', {});
    }
    this.isLoading = false;
  }

  async loadRecipe(id: string | null, fitToWindow = true): Promise<void> {
    this.activeRecipe = null;
    if (!id) {
      console.log(`Unable to load recipe with id: ${id}`);
      return;
    }

    let result;
    try {
      result = await axios.get(`/api/v1/workflow/${id}`, { withCredentials: true });
    } catch (e) {
      console.log(`Error loading recipe with id: ${id}, error: ${e}`);
      return;
    }

    const json = result.data.workflow;
    const flags = result.data.flags as string[];

    await this.loadFromJSON(json, flags, fitToWindow);
  }

  async onLoadRecipeFromFileChange(event: any) {
    const files = event?.dataTransfer?.files || event?.target?.files;

    let recipe: any;
    if (files.length > 0) {
      const wfDef = files[0];
      if (wfDef.name.endsWith('.json') && wfDef.type === 'application/json') {
        recipe = await new Promise((resolve, reject) => {
          const fileReader = new FileReader();
          fileReader.onload = (event) => {
            // @ts-ignore
            resolve(JSON.parse(event?.target?.result ?? '{}'));
          };
          fileReader.onerror = (error) => {
            reject(error);
          };
          fileReader.readAsText(wfDef);
        });
      }
    }

    if (recipe?.id && recipe?.meta?.name && recipe?.rete?.id?.startsWith('mercs@')) {
      recipe.id = ''; // Imported recipes are assigned a new id.
      await this.loadFromJSON(recipe);
      this.activeWorkflow?.setDirty();
    }
  }

  writeActiveRecipeIdToLocalStorage() {
    const id = this.activeWorkflow?.id;
    if (!id) {
      // e.g. not saved yet.
      window.localStorage.removeItem('active_recipe_id');
      return;
    }
    window.localStorage.setItem('active_recipe_id', id);
  }

  generateAutoHelp(recipe: ClientWorkflow): string {
    const header = '## New Recipe Checklist  \n*Steps to take before running your recipe:*  \n\n';

    const steps: any[] = [
      {
        text: 'Add a Recipe Metadata Block',
        check: () => recipe.rete.nodes.find((n: any) => n.name === 'omnitool.recipe_metadata')
      },
      {
        text: 'Add a Chat Input Block',
        check: () => recipe.rete.nodes.find((n: any) => n.name === 'omnitool.chat_input')
      },
      {
        text: 'Add a Chat Output Block',
        check: () => recipe.rete.nodes.find((n: any) => n.name === 'omnitool.chat_output')
      },
      {
        text: 'Replace this Checklist by adding your own help information into the recipe metadata block',
        check: () => false
      }
    ];
    const footer = '  \n\nThis checklist auto-updates every time the recipe is saved.';
    const markdown =
      header + steps.map((s: any) => (s.check() ? `✅ ${s.text}` : `🔲 ${s.text}`)).join('  \n') + footer;
    return markdown;
  }

  showTutorial(modal: boolean) {
    const singletonHash = 'workflow-tutorial';
    this.showExtension(
      'omni-core-viewers',
      { video: 'https://github.com/mercenaries-ai/omnitool-tutorials/releases/download/latest/quickstart.mp4' },
      'video.html',
      {
        singletonHash,
        winbox: { title: 'Quickstart Video', minwidth: 960, minheight: 575, modal }
      }
    );
  }

  showApiManagement() {
    this.showExtension('omni-core-collectionmanager', { type: 'api' }, undefined, {
      winbox: { title: 'API Management', modal: true },
      singletonHash: 'omni-core-collectionmanager-api'
    });
  }

  toggleDevTool() {
    if (this.getClient().extensions.has('omni-extension-log-viewer')) {
      const singletonHash = 'omni-extension-log-viewer';
      if (this.getClient().getWindow(singletonHash)) {
        this.getClient().closeWindow(singletonHash);
      } else {
        this.showExtension('omni-extension-log-viewer', {}, undefined, {
          winbox: {
            title: 'Developer Tool',
            x: 'center',
            y: 'bottom',
            width: 1000,
            height: 200
          },
          singletonHash: 'omni-extension-log-viewer'
        });
      }
    }
  }

  showRecipeHelp() {
    const singletonHash = 'workflow-intro';
    const recipe = this.activeRecipe;
    if (!recipe) {
      this.getClient().closeWindow(singletonHash);
      return;
    }

    const help = recipe?.meta?.help?.trim();
    const markdown = help ? (help.length ? help : this.generateAutoHelp(recipe)) : this.generateAutoHelp(recipe);

    const uiHash = 'workflow-ui' + recipe.id;
    // @ts-ignore
    const hasUI: { data: any } = Object.values(window.Alpine.raw(recipe.rete.nodes)).find(
      (n: any) => n.name === 'omni-core-formio:formio.auto_ui'
    );

    if (hasUI && hasUI.data.enableUI) {
      this.showExtension(
        'omni-core-formio',
        { recipe: { id: recipe.id, version: undefined } },
        hasUI.data.editMode ? 'edit' : 'render',
        {
          singletonHash: uiHash,
          winbox: {
            title: '▶️' + recipe.meta.name,
            x: 'center',
            y: 'center',

            autosize: true
          },
          hideToolbar: true
        }
      );
    }

    this.showExtension('omni-core-viewers', { markdown }, 'markdown', {
      singletonHash,
      winbox: {
        title: "💡 '" + recipe.meta.name + "' - Information",
        x: 'right',
        y: 'bottom',
        minheight: 450,
        minwidth: 400,
        autosize: true
      },
      hideToolbar: true
    });
  }
}

export { ClientWorkflow, Workbench };
