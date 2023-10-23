/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import insane from 'insane';
import { type IDBObjectLink } from '../objects/DBObject';

enum EWorkflowVisibility {
  PUBLIC = 'public'
}

interface IWorkflowMeta {
  name: string;
  author: string;
  description: string;
  category?: string;
  help?: string;
  created?: number;
  updated?: number;
  pictureUrl?: string;
  tags?: string[];
}

interface IWorkflowAPIField {
  type: string;
  default: any;
  options: any;
}

class BaseWorkflow {
  id: string;
  meta!: IWorkflowMeta;
  rete!: {
    id: string;
    nodes: Record<string, any>;
  };

  ui?: {
    template?: string;
    chat?: any;
    formIO?: any;
  };

  api!: {
    fields: Record<string, IWorkflowAPIField>;
  };

  get blockIds(): string[] {
    return Array.from(new Set<string>(
      Object.values(this?.rete?.nodes ?? {}).map(node => node.name)
    )).sort();
  }

  constructor(id?: string, meta?: IWorkflowMeta) {
    this.id = id ?? '';
    this.setMeta(meta);
    this.setRete(null);
    this.setAPI(null);
    this.setUI(null);
  }

  setMeta(meta?: IWorkflowMeta): BaseWorkflow {
    meta = JSON.parse(JSON.stringify(meta ?? {})); // Ensure original object is not modified
    meta = meta ?? { name: 'New Recipe', description: 'No description.', pictureUrl: 'omni.png', author: 'Anonymous' };
    this.meta = meta;
    this.meta.updated ??= Date.now();
    this.meta.created ??= Date.now();
    this.meta.tags ??= [];
    this.meta.author ||= 'Anonymous';
    this.meta.help ||= '';
    // @ts-ignore
    this.meta.name = insane(this.meta.name, { allowedTags: [], allowedAttributes: {} });
    // @ts-ignore
    this.meta.description = insane(this.meta.description, { allowedTags: [], allowedAttributes: {} });
    // @ts-ignore
    this.meta.author = insane(this.meta.author, { allowedTags: [], allowedAttributes: {} });
    // @ts-ignore
    this.meta.help = insane(this.meta.help, { allowedTags: [], allowedAttributes: {} });

    return this;
  }

  setRete(rete: any): BaseWorkflow {
    this.rete = rete;
    return this;
  }

  setAPI(api: any): BaseWorkflow {
    this.api = api ?? { fields: {} };
    return this;
  }

  setUI(ui: any): BaseWorkflow {
    this.ui = ui ?? {};
    return this;
  }

  get isBlank(): boolean {
    return (this?.rete?.nodes ?? []).length === 0;
  }

  toJSON() {
    return {
      id: this.id,
      meta: this.meta,
      rete: this.rete,
      api: this.api,
      ui: this.ui,
      blockIds: this.blockIds
    };
  }

  static fromJSON(json: any): BaseWorkflow {
    const result = new BaseWorkflow(json.id);

    result.setMeta(json.meta);

    //Migration: Replace all instances of omni-extension-replicate: with omni-core-replicate:
    json.rete.nodes = JSON.parse(JSON.stringify(json.rete.nodes).replace(/omni-extension-replicate:/g, 'omni-core-replicate:'))
    //Migration: Replace all instances of omni-extension-formio: with omni-core-formio:
    json.rete.nodes = JSON.parse(JSON.stringify(json.rete.nodes).replace(/omni-extension-formio:/g, 'omni-core-formio:'))
    

    result.setRete(json.rete);
    result.setAPI(json.api);
    result.setUI(json.ui);
    return result;
  }
}

class Workflow extends BaseWorkflow {
  _id?: string; // DEPRECATED! Remove!
  _rev?: string; // DEPRECATED! Remove!

  owner: string;
  org: IDBObjectLink;
  // publishedTo: string[] // Either 'public', organisation IDs, group IDs, or user IDs

  constructor(id: string, data: { owner: string; org: IDBObjectLink }, meta?: IWorkflowMeta) {
    super(id, meta);
    this._id = `wf:${id}`;
    this.owner = data.owner;
    this.org = data.org;
    // this.publishedTo = []
  }

  static readonly modelName = 'Workflow';

  toJSON() {
    return {
      ...super.toJSON(),
      _id: this._id,
      _rev: this._rev,
      owner: this.owner,
      org: this.org
      // publishedTo: this.publishedTo
    };
  }

  static fromJSON(json: any): Workflow {
    let id = json._id?.replace('wf:', '') || json.id;
    if (json.id && json.id.length > 16 && id.startsWith(json.id)) {
      id = json.id; // Published workflows might have `id` different from `_id`.
    }

    const result = new Workflow(id, { owner: json.owner || json.meta.owner, org: json.org });

    // result.publishedTo = json.publishedTo

    json.rete = JSON.parse(JSON.stringify(json.rete).replace(/omni-extension-replicate:/g, 'omni-core-replicate:'))
    json.rete = JSON.parse(JSON.stringify(json.rete).replace(/omni-extension-formio:/g, 'omni-core-formio:'))
    result.setMeta(json.meta);
    result.setRete(json.rete);
    result.setAPI(json.api);
    result.setUI(json.ui);

    if (json._rev) {
      result._rev = json._rev; // TODO: Cleanup
    }

    return result;
  }
}

export { BaseWorkflow, EWorkflowVisibility, Workflow, type IWorkflowMeta };
