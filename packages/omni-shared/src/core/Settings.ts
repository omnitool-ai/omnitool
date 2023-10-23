/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { omnilog } from './OmniLog.js';

// A generic interface representing a setting in the application.
interface ISetting<T> {
  key: string;
  defaultValue: T;
  value: T;
  // validate?: (value: T) => boolean;
}

// Implementation of the ISetting interface for number values.
interface INumberSetting extends ISetting<number> {}
interface IStringSetting extends ISetting<string> {}
interface IBooleanSetting extends ISetting<boolean> {}
interface IArraySetting extends ISetting<[]> {}

interface IStorageAdapter<T> {
  delete: (key: string) => void;
  get: (key: string) => T;
  set: (key: string, value: T, expiry?: number) => void;
  values: () => IterableIterator<T>;
  has: (key: string) => boolean;
}

// Represents a system that manages a set of settings for a given namespace.
class Settings {
  private readonly scope?: string;
  private settings: IStorageAdapter<ISetting<any>> | Map<string, ISetting<any>> = new Map<string, ISetting<any>>();

  constructor(scope?: string) {
    this.scope = scope;
  }

  bindStorage(storage: IStorageAdapter<ISetting<any>>) {
    this.settings = storage;
  }

  // Adds a setting to this system.
  add(setting: ISetting<any>): this {
    // if (setting.validate && !setting.validate(setting.value)) {
    //   throw new Error(`Invalid value for ${setting.key}`);
    // }
    if (this.settings.has(setting.key)) {
      omnilog.debug(`Setting ${setting.key} already exists, doing nothing...`);
      return this;
    }

    this.settings.set(setting.key, setting);
    return this;
  }

  // Retrieves a setting by its key.
  get<T>(key: string): ISetting<T> | undefined {
    return this.settings.get(key);
  }

  // Updates a setting's value and validates it.
  update<T>(key: string, newValue: T): void {
    const setting = this.get<T>(key);
    if (setting) {
      setting.value = newValue;
      this.settings.set(key, setting);
    }
  }

  // Resets a specific setting to its default value.
  reset(key: string): void {
    const setting = this.get<any>(key);
    if (setting) {
      setting.value = setting.defaultValue;
      this.settings.set(key, setting);
    }
  }

  // Resets all settings to their default values.
  resetAll(): void {
    if (this.settings) {
      for (const s of this.settings.values()) {
        s.value = s.defaultValue;
        this.settings.set(s.key, s);
      }
    }
  }

  // Retrieves all settings in this system.
  getAll(): ISetting<any>[] {
    return Array.from(this.settings.values());
  }

  //Deletes a setting from the server
  delete(key: string): void {
    this.settings.delete(key);
  }
}

export {
  Settings,
  type INumberSetting,
  type IStringSetting,
  type IBooleanSetting,
  type ISetting,
  type IArraySetting,
  type IStorageAdapter
};

/*
// Usage example

const serverPort: INumberSetting = {
  key: "server.network.port",
  defaultValue: 3000,
  value: 3000,
  validate: (value: number) => value >= 1025 && value <= 65534,
  update(newValue: number) {
    if (this.validate && !this.validate(newValue)) {
      throw new Error(`Invalid value for ${this.key}`);
    }
    this.value = newValue;
  },
  reset() {
    this.value = this.defaultValue;
  },
};

const serverSettings = new Settings("server.network");
serverSettings.add(serverPort);
*/
