/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import {
  type IManager,
  Service,
  type IServiceConfig,
  Job,
  JOBSTATE,
  type IJobUpdateMessage,
  type IMessage
} from 'omni-shared';
import type Client from '../core/Client.js';

interface IJobControllerClientServiceConfig extends IServiceConfig {
  jobStorage?: Record<string, Job>;
}

class JobControllerClientService extends Service {
  jobStorage: Record<string, Job>;

  constructor(id: string, manager: IManager, config: IJobControllerClientServiceConfig) {
    super(id, manager, config || { id });
    this.jobStorage = config.jobStorage ?? {};
  }

  async getJobFromId(jobId: string): Promise<Job> {
    let job = this.jobStorage[jobId];
    if (job) {
      return job;
    }
    job = new Job({ id: jobId });
    this.jobStorage[jobId] = job;
    const client = this.app as Client;
    await client.sendSystemMessage(job.id, 'omni/job', {
      commands: [
        {
          title: '🛑 Stop',
          id: 'stop',
          args: [job.id],
          classes: 'rounded',
          ctx: { job },
          show: (ctx: any) => ctx.job.state === JOBSTATE.RUNNING || ctx.job.state === JOBSTATE.READY
        }
      ]
    });
    return job;
  }

  getJobsforWorkflow(workflowId: string) {
    return Object.values(this.jobStorage).filter((job) => job.workflowId === workflowId);
  }

  removeJob(jobId: string) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.jobStorage[jobId];
  }

  async handleMessages(message: IMessage) {
    const jobId = message?.body?.jobId;
    if (!jobId) {
      this.error('no jobId in job message');
      return;
    }
    const { state, workflowId, meta, errors } = message.body;

    const job = await this.getJobFromId(jobId);

    job.state = state;
    job.workflowId = workflowId;
    job._meta ??= meta;
    job.errors = errors;
    const updateMessage = message as IJobUpdateMessage;
    const { activeNode, activeNodeName } = updateMessage.body;
    job._activeNodeName = activeNodeName;
    job._activeNode = activeNode;
    if (activeNode.length > 0 && activeNodeName) {
      job.setNodeName(activeNode[0], activeNodeName);
    }
    switch (state) {
      case JOBSTATE.RUNNING:
        job._activity = 'Running...';
        break;
      case JOBSTATE.ERROR:
        job._activity = 'Failed';
        break;
      case JOBSTATE.FORCESTOP:
        job._activity = 'Stopping...';
        break;
      default:
        job._activity = `${state.charAt(0).toUpperCase()}${state.slice(1)}`; // e.g. "active" -> "Active"
        break;
    }
  }

  create() {
    this.info(`${this.id} create`);
    return true;
  }

  async load() {
    this.info(`${this.id} load`);
    return true;
  }

  async start() {
    this.info(`${this.id} start`);
    return true;
  }

  async stop() {
    this.info(`${this.id} stop`);
    return true;
  }
}

export { JobControllerClientService, type IJobControllerClientServiceConfig };
