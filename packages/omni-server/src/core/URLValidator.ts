/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { type IApp } from 'omni-shared';
import { type OmniNamespaceDefinition, type OmniComponentFormat } from 'omni-sockets';

/**
 * Validates a URL against a list of allowed/forbidden URLs
 */
class URLValidator {
  mode: string;
  list: string[];
  contentType: string[];
  app: IApp;

  constructor(server: IApp) {
    this.app = server;

    // load list of allowed url from server settings
    this.mode = this.app.settings.get<string>('omni:api.fetch.policy.url.type')?.value ?? 'deny_all_except';
    this.list = this.app.settings.get<string[]>('omni:api.fetch.policy.url.list')?.value ?? [];
    this.contentType = this.app.settings.get<string[]>('omni:api.fetch.policy.content-type')?.value ?? [];
  }

  async init() {
    this.app.events.on('blocks_reset', () => {
      // Reset the settings
      this.app.settings.reset('omni:api.fetch.policy.url.type');
      this.app.settings.reset('omni:api.fetch.policy.url.list');
      this.app.settings.reset('omni:api.fetch.policy.content-type');

      // Reload the URL validator to clear in memory cache
      this.load();
    });

    this.app.events.on('register_namespace', (namespace: OmniNamespaceDefinition) => {
      // Add the domain of the base path to the list of allowed URLs
      // We only add if the mode is deny all except a list of allowed urls
      if (this.mode === 'deny_all_except' && namespace.api) {
        if (namespace.api.basePath) {
          // Get the domain of the base path.
          const urlObj = new URL(namespace.api.basePath);
          const domain = urlObj.host;

          // Add the domain to the list of allowed URLs
          const urlList = this.app.settings.get<string[]>('omni:api.fetch.policy.url.list')?.value;
          omnilog.debug(`🔧 HttpClientService: Adding ${domain} to the list of allowed URLs`);
          if (urlList && !urlList.includes(domain)) {
            urlList.push(domain);
            this.app.settings.update('omni:api.fetch.policy.url.list', urlList);
          }
        }
      }
    });

    this.app.events.on('register_blocks', (blocks: OmniComponentFormat[]) => {
      blocks.forEach((block) => {
        const contentTypeList = this.app.settings.get<string[]>('omni:api.fetch.policy.content-type')?.value;
        omnilog.debug(`🔧 HttpClientService: Adding ${block.responseContentType} to the list of allowed content types`);
        if (contentTypeList && !contentTypeList.includes(block.responseContentType)) {
          contentTypeList.push(block.responseContentType);
          this.app.settings.update('omni:api.fetch.policy.content-type', contentTypeList);
        }
      });
    });
  }

  /**
   * Validates a URL against a list of allowed/forbidden domains
   * @param url The URL to validate
   * @returns true if the URL is allowed, false otherwise
   */
  validate(url: string): boolean {
    // Get the domain of a URL
    const getDomain = (url: string) => {
      const urlObj = new URL(url);
      return urlObj.host;
    };

    omnilog.debug(`🔧 URLValidator: Validating ${getDomain(url)}, ${this.mode}, ${this.isInList(getDomain(url))}`);

    if (this.mode === 'deny_all_except') {
      if (this.list.length > 0) {
        if (!this.isInList(getDomain(url))) {
          omnilog.info(`🚫 URLValidator: ${getDomain(url)} is not allowed`);
          return false;
        }
      }
    } else if (this.mode === 'allow_all_except') {
      if (this.list.length > 0) {
        if (this.isInList(getDomain(url))) {
          omnilog.info(`🚫 URLValidator: ${getDomain(url)} is not allowed`);
          return false;
        }
      }
    }

    omnilog.info(`👍 URLValidator: ${getDomain(url)} is allowed`);
    return true;
  }

  // Check if the URL is in the list
  private isInList(url: string): boolean {
    if (this.list.length > 0) {
      if (this.list.includes(url)) {
        return true;
      }
    } else {
      // Load the list from server settings
      this.load();
    }
    return this.list.includes(url);
  }

  /**
   * Validates a URL against a list of allowed/forbidden content types
   * @param contentType The content type to validate
   * @returns true if the content type is allowed, false otherwise
   */
  validateContentType(contentType: string): boolean {
    if (this.contentType.length > 0) {
      if (!this.contentType.includes(contentType)) {
        omnilog.debug(`🚫 URLValidator: ${contentType} is not allowed`);
        //return false;
      }
    }

    return true;
  }

  /**
   * We cache the URLs in memory to optimise API calls
   * This method reloads the URLs from the server settings.
   * Right now we load the URLs if we doesn't get a hit on the memory cache.
   *
   * TODO: Consider reloading the URLs from the server settings periodically/on every settings update
   */
  load() {
    this.mode = this.app.settings.get<string>('omni:api.fetch.policy.url.type')?.value ?? 'allow_all_except';
    this.list = this.app.settings.get<string[]>('omni:api.fetch.policy.url.list')?.value ?? [];
    this.contentType = this.app.settings.get<string[]>('omni:api.fetch.policy.content-type')?.value ?? [];
  }
}

export { URLValidator };
