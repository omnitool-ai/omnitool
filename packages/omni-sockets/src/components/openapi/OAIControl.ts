/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import Rete from 'rete';
import { type OmniControl, type OmniIO } from './types.js';
import { WorkflowClientControlManager } from '../WorkflowClientControlManager.js';

class OAIControl31 extends Rete.Control {
  data: OmniControl;
  props: { ikey: string };
  emitter?: any;
  constructor(config: OmniControl, control: any, emitter: any) {
    super(config.name);
    this.data = JSON.parse(JSON.stringify(config));

    this.emitter = emitter;
    this.props = { ikey: config.name };
    // @ts-expect-error
    this.component = control;

    if (!control) {
      console.error('Could not find component for ' + config.controlType);
    }
    // handle various types of choices array
  }

  async initChoices(): Promise<void> {
    if (this.data.choices) {
      const choices = this.data.choices;

      if (Array.isArray(choices)) {
        this.data.choices = choices.map(function (v: any) {
          if (typeof v === 'object') {
            return v;
          } else {
            return { value: v, title: v };
          }
        });
      }
      if (typeof this.data.choices === 'object') {
        const choices = this.data.choices as { block: any; args: any; map: any; cache?: 'global' | 'user' | 'none' };
        if (choices.block) {
          let list: any = ['Internal Error Fetching choices'];
          try {
            list = await (globalThis as any).client.runBlock({
              block: choices.block,
              args: choices.args || {},
              cache: choices.cache ?? choices.map.cache ?? 'none'
            });
          } catch (ex: any) {
            console.error('Could not load choices for ' + this.data.name + ': ' + ex.message);
            list = ['ERROR: ' + ex.message, this.data.default];
          }
          if (list.error) {
            console.error('Could not load choices for ' + this.data.name + ': ' + list.error.message);
            list = ['ERROR: ' + list.error, this.data.default];
          }

          const root = choices.map?.root;

          if (root && list[root] != null) {
            // Convert the object to an array if it's not already an array
            list = Array.isArray(list[root]) ? list[root] : Array.from(Object.values(list[root]));
          }

          if (!Array.isArray(list)) {
            list = Array.from(Object.values(list));
          }

          interface Choice {
            value: any;
            title: string;
            description: string;
          }

          const filterRegex = new RegExp(choices.map?.filter?.value);
          this.data.choices = list
            .map((v: any) => {
              let e: Choice = { value: v, title: v, description: '' };
              if (choices.map?.value && choices.map?.title) {
                e = {
                  value: v[choices.map.value],
                  title: v[choices.map.title],
                  description: v[choices.map.description] || ''
                };
              }
              return e;
            })
            .filter((e: Choice) => e.value && filterRegex.test(e.title))
            .sort((a: Choice, b: Choice) => b.title.localeCompare(a.title));
        }
      }
    }
  }

  get dataType() {
    return this.data.dataType ?? 'string';
  }

  get controlType() {
    console.log('Access to field controlType on control');
    return this.data.controlType;
  }

  get type() {
    console.trace();
    console.log('Access to deprecated field type on control');
    return this.data.dataType;
  }

  get opts() {
    return this.data;
  }

  get displays() {
    return this.data.displays ?? null;
  }

  get minimum() {
    return this.data.minimum;
  }

  get description() {
    return this.data.description;
  }

  get title() {
    return this.data.title ?? this.data.name;
  }

  get maximum() {
    return this.data.maximum;
  }

  get customData() {
    return this.data.customData ?? {};
  }

  custom(key: string) {
    return this.data.customData?.[key] ?? null;
  }

  get choices() {
    return this.data.choices ?? ['(default)'];
  }

  get readonly() {
    return this.data.readonly ?? false;
  }

  _formatValue(val: any) {
    if (val) {
      if ((this.dataType === 'number' || this.dataType == 'float') && typeof val === 'string') {
        val = parseFloat(val);
      } else if (this.dataType === 'integer' && typeof val === 'string') {
        val = parseFloat(val);
      } else if (this.dataType === 'boolean' && typeof val === 'number') {
        val = val != 0;
      } else if (this.dataType === 'boolean' && typeof val === 'string') {
        val = [true, 'true', '1', 'on', 'active'].includes(val.toLowerCase());
      }
    }

    return val;
  }

  setValue(val: any) {
    // Readonly or 'displays' properties are not settable
    if (this.displays || this.readonly) {
      return;
    }
    val = this._formatValue(val);
    this.putData(this.props.ikey, val);
    // @ts-ignore
    this.update();
  }

  static async fromControl(ctl: OmniControl, emitter: any): Promise<OAIControl31> {
    const control = WorkflowClientControlManager.getInstance().get(ctl.controlType);
    const ret = new OAIControl31(ctl, control, emitter);
    await ret.initChoices();
    return ret;
  }

  static async fromIO(ctlType: string, io: OmniIO, emitter: any): Promise<OAIControl31> {
    const control = {
      dataType: io.type,
      controlType: ctlType,
      name: io.name,
      title: io.title,
      choices: io.choices,
      description: io.description,
      step: io.step,
      default: io.default,
      minimum: io.minimum,
      maximum: io.maximum,
      required: io.required,
      ...(io.control || {})
    };

    const ctl = WorkflowClientControlManager.getInstance().get(ctlType);
    const ret = new OAIControl31(control, ctl, emitter);
    await ret.initChoices();
    return ret;
  }
}

export default OAIControl31;
