/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { Control } from 'rete';

interface IWorkflowComponentControlDefOpts {
  readonly?: boolean;
  default?: any;
  min?: number;
  max?: number;
  placeholder?: string;
  choices?:
    | Array<{
        id: string;
        name: string;
      }>
    | string[];
}

interface IWorkflowComponentControlDef {
  key: string;
  emitter: any;
  title: string;
  clientControl: any;
  displays?: string;
  description?: string;
  opts: IWorkflowComponentControlDefOpts;
}

interface IOpenAPIComponentControlDef {
  key: string;
  emitter: any;
  title?: string;
  control: any;
  displays?: string;
  rules?: any;
  opts: any;
  description?: string;
  slot?: string;
}

class OpenAPIComponentControl extends Control {
  props: any;
  config: IOpenAPIComponentControlDef;
  title?: string;
  opts: {};
  emitter?: any;
  description?: string;
  slot?: string;
  required: boolean;
  constructor(config: IOpenAPIComponentControlDef) {
    super(config.key);
    config.opts ??= {
      readonly: false
    };
    this.config = config;
    this.title = config.title;
    this.opts = config.opts ?? {};
    this.props = {
      emitter: config.emitter,
      ikey: config.key,
      title: config.title,
      rules: config.rules,
      opts: config.opts
    };
    this.emitter = config.emitter;
    this.description = config.description;
    // @ts-ignore
    this.component = config.control;
    this.slot = config.slot ?? 'top';
    this.required = config.opts.required === true;
  }

  setValue(val: any) {
    this.putData(this.props.ikey, val);
    // @ts-ignore
    this.update();
  }
}

export {
  OpenAPIComponentControl,
  type IOpenAPIComponentControlDef,
  type IWorkflowComponentControlDef,
  type IWorkflowComponentControlDefOpts
};
