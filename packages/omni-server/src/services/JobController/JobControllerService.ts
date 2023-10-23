/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//
// Part of this code is adapted from rete.js 1.x
//
import { type IManager, Service, type IServiceConfig, type Workflow } from 'omni-shared';
import { WorkflowJob, JOBSTATE } from './WorkflowJob.js';
import { WorkerContext, JobContext, type OAIBaseComponent } from 'omni-sockets';

import type Server from '../../core/Server.js';
import { type WorkerInputs, type WorkerOutputs } from 'rete/types/core/data.js';

/**
 * Write a TypeScript function `topologicalSort(nodes: any[])`
 * that performs a depth-first search on a graph,
 * identifying cycles and providing a traversal order.
 * Nodes in cycles should have their runState set to 'deadLock'.
 * Return an object containing the search order and a
 * boolean indicating whether the graph is computable (cycle-free).
 */

function topologicalSort(nodes: any[]) {
  const visited = new Set();
  const stack: number[] = [];
  let computable = true;

  function depthFirstSearch(vertex: number): boolean {
    if (visited.has(vertex)) {
      return stack.findIndex((x) => x === vertex) >= 0;
    }
    visited.add(vertex);

    const node = nodes[vertex];

    for (const inputKey of Object.keys(node.inputs)) {
      const inputConns = node.inputs[inputKey].connections;
      for (const i in inputConns) {
        const inputNodeProto: any = inputConns[i];
        if (inputNodeProto) {
          if (!depthFirstSearch(inputNodeProto.node)) {
            computable = false;
            node.runState = 'deadLock';
          }
        }
      }
    }

    stack.push(vertex);
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-for-in-array
  for (const key in nodes) {
    depthFirstSearch(nodes[key].id);
  }

  return { searchOrder: stack, computable };
}

interface IJobControllerServiceConfig extends IServiceConfig {}
type JobId = string; // ...TODO...

class JobControllerService extends Service {
  jobs = new Map<JobId, WorkflowJob>();

  constructor(id: JobId, manager: IManager, config: IJobControllerServiceConfig) {
    super(id, manager, config || { id });
  }

  getApp(): Server {
    return this.app as Server;
  }

  async start(): Promise<boolean> {
    return true;
  }

  stopJob(jobId?: string): number {
    let result = 0;
    this.jobs.forEach((job: WorkflowJob, id: string) => {
      if (jobId && jobId !== id) {
        return;
      }
      if (job.forceStop()) {
        result++;
      }
    });
    return result;
  }

  async skipNode(node: any): Promise<void> {
    node.runState = 'skipped';
    node.outputDataInstance = {};
  }

  simplifyErrors(nodeError: any): string {
    // A variety of heuristics for simplifying errors.
    for (let i = 0; i < 3; i++) {
      nodeError = nodeError?.error || nodeError; // {error:x} -> x
      nodeError = nodeError?.message || nodeError; // {message:x} -> x
      try {
        nodeError = JSON.parse(nodeError);
      } catch {} // string -> object
    }
    if (typeof nodeError !== 'string') {
      nodeError = JSON.stringify(nodeError); // Always return a string.
    }
    return nodeError;
  }

  async _runBlockInParallel(
    job: WorkflowJob,
    node: any,
    component: OAIBaseComponent,
    inputData: WorkerInputs,
    key: number
  ) {
    await this.emit('job_worker_start', [job, node, component, inputData, job.context.workflowId]);
    await this.app.emit('sse_message', {
      type: 'job_state',
      event: 'node_started',
      args: { node_id: node.id, job_id: job.id },
      sessionId: job.context.sessionId,
      userId: job.context.userId,
      workflowId: job.context.workflowId
    });

    const workerContext = WorkerContext.create(
      this.app,
      job.engine,
      {
        id: node.id,
        data: node.data,
        inputs: inputData,
        outputs: {} satisfies WorkerOutputs
      },
      {
        sessionId: job.context.sessionId,
        userId: job.context.userId,
        jobId: job.id,
        workflowId: job.context.workflowId,
        args: job.context.args,
        flags: job.context.flags
      }
    );

    await component.workerStart(inputData, workerContext);

    // Only assign `outputDataInstance` *after* workerStart has awaited to avoid race conditions.
    node.outputDataInstance = workerContext.outputs;

    node.runState = 'finished';

    await this.emit('job_worker_result', [job, node, component, node.outputDataInstance]);
    this.info('Worker result', job.id, node.id, component.name, Object.keys(node.outputDataInstance || {}));
    await this.app.emit('sse_message', {
      type: 'job_state',
      event: 'node_finished',
      args: { node_id: node.id, job_id: job.id },
      sessionId: job.context.sessionId,
      userId: job.context.userId
    });

    // Rethrow errors if they haven't been cleared in node_finished.
    let nodeError = node.outputDataInstance?.error;
    if (nodeError) {
      if ((global as any).DebugOnNodeReturn) {
        // eslint-disable-next-line no-debugger
        debugger;
      }

      // Simplify node errors before passing them up the stack.
      nodeError = this.simplifyErrors(nodeError);

      throw new Error(nodeError);
    }
  }

  async runBlockInParallel(
    job: WorkflowJob,
    node: any,
    component: OAIBaseComponent,
    inputData: WorkerInputs,
    key: number
  ) {
    node.runState = 'running';
    job.addActiveNode(node.id);

    try {
      // Call internal version.
      await this._runBlockInParallel(job, node, component, inputData, key);
    } catch (e: any) {
      node.runState = 'error';
      job.engine.trigger('warn', e);
      job.addError(key, `${e.message}`, e);
      job.state = JOBSTATE.ERROR;
      omnilog.error('Error running node', e);
    }

    job.removeActiveNode(node.id);
  }

  async advanceRecipe(job: WorkflowJob): Promise<void> {
    if (!job) {
      omnilog.log('Recipe has already completed, stale result');
      return;
    }
    const nodes: any = job.rete?.nodes ?? [];

    const n = Object.keys(nodes).length;
    const { searchOrder } = topologicalSort(nodes);

    let canFinish = true;
    for (let j = 0; j < n; j++) {
      if (job.state !== JOBSTATE.RUNNING) {
        this.warn('Job is not running, giving up ... status: ', job.state, job);
        break;
      }
      const key = searchOrder[j];
      const node = nodes[key];
      if (node.runState) {
        continue; // Node is running or finished or skipped etc
      }

      if (!(node?.data?.xOmniEnabled ?? true)) {
        this.info(`node "${node.name}" is disabled in the editor, skipping node`);
        await this.skipNode(node);
        continue;
      }

      canFinish = false;

      const component = job.engine.components.get(node.name) as OAIBaseComponent;
      let canRun: boolean = true;

      if (!component) {
        this.error(`Component ${node.name} not found`);
        job.addError(key, `Component ${node.name} does not exist`, 'error');
        break;
      }

      let executable = true;
      const inputData: WorkerInputs = {};

      // Extract Input Data
      for (const inputKey of Object.keys(node.inputs)) {
        const inputConns = node.inputs[inputKey].connections;
        if (!inputConns.length) {
          continue;
        }
        const inputArray: any = [];
        // create a set of input nodes
        const safeInputNodesSet = new Set();
        const toxicInputNodesSet = new Set();

        for (const i in inputConns) {
          const inputNodeProto: any = inputConns[i];
          if (inputNodeProto) {
            const inputNode = nodes[inputNodeProto.node];
            if (inputNode.runState === 'deadLock') {
              executable = false;
              job.addError(key, 'Recipe has deadlocked. Forcing progress.', 'error');
              break;
            }

            if (!('outputDataInstance' in inputNode)) {
              canRun = false; // Inputs are not ready yet, keep searching for a runnable node.
              break;
            }

            const inputSafe = inputNodeProto.output in (inputNode.outputDataInstance ?? {});
            if (inputSafe) {
              safeInputNodesSet.add(inputNode);
            } else {
              toxicInputNodesSet.add(inputNode);
            }

            const output = inputNode.outputDataInstance?.[inputNodeProto.output];
            inputArray.push(output);
          }
        }
        inputData[inputKey] = inputArray;

        // When we check further up, we don't get dynamic data feeding into enabled
        // So we validate that here.
        if (!(inputData?.xOmniEnabled ?? true)) {
          this.info(`node "${node.name}" was disabled at runtime, skipping node`);
          await this.skipNode(node); // Should probably be `executable = false`
          continue;
        }
      }

      if (!canRun) {
        continue; // Choose a different node.
      }

      if (!executable) {
        await this.skipNode(node);
        await this.advanceRecipe(job); // Restart from beginning
        return;
      }

      job.runningNodes++;

      this.runBlockInParallel(job, node, component, inputData, key).then(
        async () => {
          job.runningNodes--;
          await this.advanceRecipe(job); // Recurse !!
        },
        (e) => {
          job.runningNodes--;
          this.error(`Error running node ${node.name}`, e);
        }
      );
    }

    if (job.runningNodes) {
      return;
    }

    if (canFinish) {
      await this.finishJob(job);
      return;
    }

    if (job.errors.length && job.state === JOBSTATE.RUNNING) {
      await this.finishJob(job);
    }
  }

  async finishJob(job: WorkflowJob): Promise<void> {
    this.success('Job instance ' + job.id + ' finished');

    job.finish();
    await this.emit('job_finished', [job.context, job]); // job.context is a member of job, do we need to pass both here?
    await this.emit('job_finished_' + job.id, [job]);

    process.nextTick(() => {
      this.jobs.delete(job.id);
    });

    await this.app.emit('sse_message', {
      type: 'job_state',
      event: 'job_finished',
      args: { job_id: job.id },
      sessionId: job.context.sessionId,
      userId: job.context.userId
    });
  }

  async startJob(job: WorkflowJob): Promise<void> {
    omnilog.log(`workflow instance ${job.id} starting`);
    job.start();

    await this.emit('job_started', job);
    await this.emit('job_started_' + job.id, [job]);
  }

  async createJob(recipe: Workflow, ctx: JobContext, startNode: number): Promise<WorkflowJob> {
    const job = new WorkflowJob(this, recipe, ctx, startNode);
    this.jobs.set(job.id, job);

    const actions = {
      cancel: false,
      cancelReason: null
    };

    await this.emit('pre_workflow_start', [recipe, job.context, actions]); // Can modify `actions`

    if (actions.cancel) {
      throw new Error('Workflow cancelled: ' + actions.cancelReason || 'No reason available');
    }

    return job;
  }

  async registerBlocksWithReteEngine(blockNames: string[], job: WorkflowJob) {
    // Note: If there are any exceptions thrown here, `job` will never start.

    // Resolve them into usable blocks...
    const userId: string = job.context.userId;
    const failBehavior = 'missing_block'; // Blocks may be disabled or missing, but we want to continue anyway.
    const results = await this.getApp().blocks.getInstances(blockNames, userId, failBehavior);
    const blocks = results.blocks

    blocks.forEach((c: any) => {

      job.engine.register(c);
    });
  }

  async startRecipe(recipe: Workflow, sessionId: string, userId: string, args: any, startNode: number, sender: string) {
    // TODO: Given that startRecipe is a public method, implement permission checks to ensure that `user`
    // has the correct permissions to execute the recipe and access the session etc.

    this.info('Recipe executing:', args, recipe.rete);
    args.botIdentity = sender;

    // Create the job context.
    const ctx: JobContext = JobContext.create(this.app, {
      sessionId,
      userId,
      workflowId: recipe.id,
      jobId: '', // Will be set in WorkflowJob constructor.
      args
    });

    // Create the actual job.
    const job = await this.createJob(recipe, ctx, startNode);
    const blockNames = Array.from(new Set(Object.values(job.rete.nodes).map((n: any) => n.name)));

    // Register blocks which are used by the job.
    await this.registerBlocksWithReteEngine(blockNames, job);

    // Change job status to JOBSTATE.RUNNING
    await this.startJob(job);

    // Notify the app that the job has started.
    await this.app.emit('sse_message', {
      type: 'job_state',
      event: 'job_started',
      args: { job_id: job.id },
      workflowId: job.context.workflowId,
      sessionId: job.context.sessionId,
      userId: job.context.userId
    });

    process.nextTick(async () => {
      // Fix race condition where an empty recipe can finish before it's started.
      // *Actually* start the first block executing (async).
      await this.advanceRecipe(job);
    });

    return {
      jobId: job.id,
      recipeId: recipe.id,
      workflowId: recipe.id,
      meta: recipe.meta
    };
  }
}

export { JobControllerService, type IJobControllerServiceConfig };
