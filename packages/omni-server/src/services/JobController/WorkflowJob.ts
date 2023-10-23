/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { v4 as uuidv4 } from 'uuid';
import * as Rete from 'rete';
import { type JobControllerService } from './JobControllerService';
import { type IMessageHeader } from 'omni-shared';
import { type JobContext } from 'omni-sockets';

enum JOBSTATE {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESS = 'success',
  STOPPED = 'stopped',
  FORCESTOP = 'forceStop',
  ERROR = 'error'
}

class WorkflowJob {
  id: string;
  engine: Rete.Engine;
  artifacts: any = {};
  _state: JOBSTATE = JOBSTATE.READY;
  _activeNode: number[] = [];
  ctx: JobContext;
  startNode: number = 0;
  data: any = {};
  snapshot: any = {};
  controller: JobControllerService;
  runningNodes: number = 0;
  errors: any[] = [];

  constructor(controller: JobControllerService, rete: any, ctx: JobContext, startNode: number = 0) {
    this.id = uuidv4();
    this.controller = controller;
    this.engine = new Rete.Engine('mercs@0.1.0');
    this.data = JSON.parse(JSON.stringify(rete)); // FIU
    ctx.setJobId(this.id);
    this.startNode = startNode;
    this.ctx = ctx;
    this.snapshot = this.engine.copy(this.data); // deep copy of data

    // @ts-ignore
    this.ctx.engine = this.engine;
  }

  set artifactsValue(value: any) {
    this.artifacts = value;
  }

  get artifactsValue(): any {
    return this.artifacts;
  }

  get context(): JobContext {
    return this.ctx;
  }

  get workflowId(): string | undefined {
    return this.ctx.workflowId;
  }

  get state(): JOBSTATE {
    return this._state;
  }

  set state(value: JOBSTATE) {
    if (value === this._state) {
      return;
    }
    this.controller.debug(`Job ${this.id} state change from '${this._state}' to '${value}'`);
    this._state = value;
    this.updateRemote();
  }

  get rete(): any {
    return this.data.rete;
  }

  addActiveNode(nodeId: number) {
    const hackUpdateClient = true; // TODO: Once job._activeNodeName is removed, set to false
    if (hackUpdateClient) {
      this._activeNode.unshift(nodeId);
    } else {
      this._activeNode.push(nodeId);
    }
    this.updateRemote();
  }

  removeActiveNode(nodeId: number) {
    this._activeNode = this._activeNode.filter((n) => n !== nodeId);
    this.updateRemote();
  }

  updateRemote(headerText = 'job:update') {
    // TODO: Defer updates to avoid flooding the client
    const header: IMessageHeader = {
      type: headerText
    };

    const meta = {
      name: this?.data?.meta?.name ?? 'Recipe'
    };

    const body = {
      jobId: this.id,
      state: this.state,
      activeNode: this._activeNode,
      activeNodeName: this.data.rete?.nodes[this._activeNode[0]]?.name,
      workflowId: this.ctx?.workflowId,
      meta,
      errors: this.errors
    };

    this.controller.emitGlobalEvent('sse_user_message', [this.ctx?.userId, header, body]);
  }

  nodeNameForId(nodeId: number): string {
    return this.data.rete.nodes[nodeId].name;
  }

  addError(nodeId: number, message: string, details: any) {
    const nodeName = this.nodeNameForId(nodeId);
    this.errors.push({ nodeId, nodeName, message, details });
    this.updateRemote('job:error');
  }

  start(): void {
    this.state = JOBSTATE.RUNNING;
  }

  finish(): void {
    if (this.state === JOBSTATE.FORCESTOP) {
      this.state = JOBSTATE.STOPPED;
      return;
    }

    if (this.state === JOBSTATE.ERROR) {
      return;
    }

    this.state = this.errors.length > 0 ? JOBSTATE.ERROR : JOBSTATE.SUCCESS;
  }

  forceStop(): boolean {
    if (this.state === JOBSTATE.SUCCESS || this.state === JOBSTATE.ERROR || this.state === JOBSTATE.STOPPED) {
      return false;
    }
    this.state = JOBSTATE.FORCESTOP;
    return true;
  }

  toJSON(details?: { rete: boolean }): { rete?: any; id: string; state: string; user: any } {
    details ??= { rete: false };
    const ret: { rete?: any; id: string; state: string; user: any } = {
      id: this.id,
      state: this.state,
      user: this.ctx?.userId
    };
    if (details.rete) {
      ret.rete = this.data;
    }
    return ret;
  }
}

export { WorkflowJob, JOBSTATE };
