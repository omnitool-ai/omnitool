/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import axios from 'axios';
import { BaseWorkflow, omnilog, type IWorkflowMeta } from 'omni-shared';

class ClientWorkflow extends BaseWorkflow {
  _errors: any[] = [];
  _dirty: number = 0; // 0 = no local changes, 1 = unsaved, any other value is a dirtyCookie, i.e. save-in-progress.
  _flags: string[] = [];

  get displayName(): string {
    let result = this.meta.name || this.id;
    if (this.isDirty) result += '*';
    if (this.readOnly) result += ' (read-only)';
    if (this.copyOnWrite) result += ' (copy-on-write)';
    return result;
  }

  hasFlag(flag: string): boolean {
    if (flag !== flag.toLowerCase()) {
      throw new Error(`ClientWorkflow Flag "${flag}" must be lower-case`);
    }
    return this._flags.includes(flag);
  }

  setFlag(flag: string, value: boolean = true) {
    if (flag !== flag.toLowerCase()) {
      throw new Error(`ClientWorkflow Flag "${flag}" must be lower-case`);
    }
    if (value) {
      // Set true
      if (!this._flags.includes(flag)) {
        this._flags.push(flag);
      }
      return;
    }
    // Set false, i.e. clear
    this._flags = this._flags.filter((f) => f !== flag);
  }

  clearFlag(flag: string) {
    this.setFlag(flag, false);
  }

  get isDirty(): boolean {
    return this._dirty !== 0;
  }

  setDirty() {
    this._dirty = 1; // i.e. unsaved.
  }

  get copyOnWrite(): boolean {
    return this.hasFlag('copyonwrite');
  }

  set copyOnWrite(value: boolean) {
    this.setFlag('copyonwrite', value);
  }

  get readOnly(): boolean {
    return this.hasFlag('readonly');
  }

  set readOnly(value: boolean) {
    this.setFlag('readonly', value);
  }

  // Clone the recipe on the server
  static async clone(data: { id: string; meta?: Partial<IWorkflowMeta> }): Promise<ClientWorkflow> {
    const result = await axios.post('/api/v1/workflow/clone', { ...data }, { withCredentials: true });

    const json = result.data.workflow;
    return ClientWorkflow.fromJSON(json);
  }

  // Returns 'true' if/when server version matches local version
  async syncToServer(): Promise<boolean> {
    if (this.readOnly) {
      /* TODO: Ensure overwriting a read-only workflow will fail on the server. */
      return false;
    }

    if (this.copyOnWrite) {
      this.copyOnWrite = false;
      this.id = '';
    }

    const dirtyCookie = new Date().getTime();
    this._dirty = dirtyCookie; // i.e. save in progress.
    this.meta.updated = Date.now();
    //@ts-ignore
    const payload = window.Alpine.raw(this.toJSON());

    try {
      const result = await axios({
        method: this.id ? 'put' : 'post',
        url: '/api/v1/workflow',
        data: payload,
        withCredentials: true
      });

      if (result.status !== 200) {
        return false; /* Unable to write to server. */
      }
      if (!result.data.workflow) {
        return false; /* Unable to write to server. */
      }
      const serverId = result.data.workflow.id;
      if (!serverId) {
        throw new Error('Server did not return a valid recipe Id');
      }
      if (this.id && this.id !== serverId) {
        omnilog.log('server updated our id unexpectedly', this.id, serverId);
      }
      this.id = serverId;
    } catch (e) {
      omnilog.log('error writing to server', e);
      return false; /* Unable to write to server. */
    }

    if (this._dirty === dirtyCookie) {
      this._dirty = 0; // Only set back to 0 if it wasn't changed while we were saving.
    }

    return true;
  }

  static fromJSON(json: any, flags: string[] | undefined = undefined): ClientWorkflow {
    const result = new ClientWorkflow(json.id);
    result.id = json.id;
    if (!result.id && json._id) {
      result.id = json._id.replace('wf:', '');
    }

    result.setMeta(json.meta);
    result.setRete(json.rete);
    result.setAPI(json.api);

    if (flags && flags.length > 0) {
      result._flags = flags;
    } else if (json._flags) {
      result._flags = json._flags;
    }

    return result;
  }

  toJSON() {
    const ret: any = super.toJSON();
    ret._flags = this._flags;
    return ret;
  }
}

export default ClientWorkflow;
