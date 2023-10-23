/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IWorkflowMeta } from '../core/Workflow';

enum JOBSTATE {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESS = 'success',
  STOPPED = 'stopped',
  FORCESTOP = 'forceStop',
  ERROR = 'error'
}

interface IJobUpdateMessage {
  type: string;
  body: {
    jobId: string;
    state: JOBSTATE;
    workflowId: string;
    activeNode: number[];
    activeNodeName: string;
    activity?: string;
  };
}

interface IJobError {
  nodeId: number;
  message: string;
  details: any;
}

class Job {
  id: string;
  private _state: JOBSTATE;
  _activeNode: number[] = [];
  _activeNodeName: string = '';
  _activity: string;
  _workflowId?: string;
  _meta?: IWorkflowMeta;
  errors: IJobError[] = [];
  _nodeNameMap: Record<number, string> = {};

  constructor(opts: { id: string; meta?: IWorkflowMeta }) {
    this.id = opts.id;

    this._state = JOBSTATE.READY;
    this._meta = opts?.meta;
    this._activity = '';
  }

  get meta(): IWorkflowMeta | undefined {
    return this._meta;
  }

  get activity(): string {
    return this._activity;
  }

  get workflowId(): string | undefined {
    return this._workflowId;
  }

  set workflowId(workflowId: string | undefined) {
    this._workflowId = workflowId;
  }

  get state() {
    return this._state;
  }

  set state(state: JOBSTATE) {
    this._state = state;
  }

  get activeNode() {
    return this._activeNode;
  }

  nodeDescriptionFromId(nodeId: number): string {
    return this._nodeNameMap[nodeId] ?? `node_${nodeId}`;
  }

  setNodeName(nodeId: number, nodeName: string) {
    this._nodeNameMap[nodeId] = nodeName;
  }
}

export { JOBSTATE, Job, type IJobUpdateMessage, type IJobError };
