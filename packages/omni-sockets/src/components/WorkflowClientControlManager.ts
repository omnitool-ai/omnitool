/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

class WorkflowClientControlManager {
  controls: Map<string, any>;
  static instance: WorkflowClientControlManager;
  constructor() {
    this.controls = new Map();
  }

  add(key: string, clientControlType: any) {
    this.controls.set(key, clientControlType);
  }

  get(id: string) {
    return this.controls.get(id);
  }

  has(id: string) {
    return this.controls.has(id);
  }

  static getInstance() {
    if (WorkflowClientControlManager.instance == null) {
      WorkflowClientControlManager.instance = new WorkflowClientControlManager();
    }
    return WorkflowClientControlManager.instance;
  }
}

export { WorkflowClientControlManager };
