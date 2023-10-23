/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { WorkflowClientControlManager } from './WorkflowClientControlManager.js';
import { OAIBaseComponent } from './openapi/OAIComponent31.js';

class WorkflowComponentRegistry {
  components: Map<string, OAIBaseComponent>;
  clientComponents: Map<string, any>;
  ctors: Map<string, any>;
  loaded: boolean = false; // May not be fully functional yet, use at own risk!!

  constructor() {
    this.components = new Map();
    this.clientComponents = new Map();
    this.ctors = new Map();
  }

  registerCtor(type: string, Ctor: any): void {
    this.ctors.set(type, Ctor);
  }

  create(definitions: any, namespace?: string) {
    let components: OAIBaseComponent[] = [];
    components = definitions
      .map((definition: any) => {
        if (definition instanceof OAIBaseComponent) {
          return definition;
        }

        definition.type ??= 'OAIBaseComponent';

        if (this.ctors.has(definition.type)) {
          const Ctor = this.ctors.get(definition.type);
          return Ctor.fromJSON(definition);
        }
        return null;
      })
      .filter((c: OAIBaseComponent) => c !== null);
    return components;
  }

  add(definitions: any) {
    this.create(definitions).forEach((component: OAIBaseComponent) => {
      this.components.set(component.name, component);
    });

    return this;
  }

  registerClientComponent(key: string, clientComponent: any) {
    this.clientComponents.set(key, clientComponent);
  }

  hasClientComponent(key: string) {
    return this.clientComponents.has(key);
  }

  getClientComponent(key: string) {
    return this.clientComponents.get(key);
  }

  get(name: string) {
    return this.components.get(name);
  }

  has(name: string) {
    return this.components.has(name);
  }

  getComponents(all?: boolean): OAIBaseComponent[] {
    let ret = Array.from(this.components.values());
    if (!all) {
      ret = ret.filter((c: OAIBaseComponent) => c.tags.includes('default'));
    }
    return ret;
  }

  getControlRegistry(): WorkflowClientControlManager {
    return WorkflowClientControlManager.getInstance();
  }

  // Singleton pattern
  static instance: WorkflowComponentRegistry;
  static getSingleton(): WorkflowComponentRegistry {
    WorkflowComponentRegistry.instance ??= new WorkflowComponentRegistry();
    return WorkflowComponentRegistry.instance;
  }
}

export { WorkflowComponentRegistry };
