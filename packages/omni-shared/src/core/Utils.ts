/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class Utils {
  static isValidUrl(str: string): boolean {
    let url;

    try {
      url = new URL(str);
    } catch (e) {
      return false;
    }

    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  static async fetchJSON(url: string, proxyViaServer: boolean = true): Promise<unknown> {
    return await new Promise((resolve, reject) => {
      if (!this.isValidUrl(url)) {
        reject(new Error(`Invalid URL: ${url}`));
      }
      if (proxyViaServer) {
        url = `/api/v1/mercenaries/fetch?url=${encodeURIComponent(url)}`;
      }

      fetch(url)
        .then((response) => {
          if (response.ok) {
            resolve(response.json());
          } else {
            reject(new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`));
          }
        })
        .catch((error) => {
          reject(new Error(`Failed to fetch ${url}: ${error}`));
        });
    });
  }
}

export { Utils }
