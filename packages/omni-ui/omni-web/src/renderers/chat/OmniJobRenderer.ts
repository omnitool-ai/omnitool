/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { ChatRenderer } from 'omni-client-services';

// A chat extension to render a onmitool job object

class OnmiJobRenderer extends ChatRenderer {
  constructor(id?: string, opts?: any) {
    super({ id: id ?? 'omni/job' }, opts);
  }

  render(content: { type: string; value: any }): string {
    const jobId: number = content.value;
    return `<div class='flex flex-col flex-wrap gap-1' x-data="{job: client.jobs.jobStorage['${jobId}']}"
            :class='{"text-gray-800": job.state == "running", "text-green-800": job.state === "success", "text-red-800": job.state == "error"}'
            x-effect="() => {
              if (job.state === 'success' || job.state === 'error') { $nextTick(() => onAsyncJobStatusEffectHandler($el, job)) }
            }"
      >
      <div class="flex">
      <span x-text="workbench.getNickname(job.workflowId) || job.meta?.name || job.id">:</span>
      &nbsp; (<span class="flex" x-text="job.activity"></span>)
      </div>
      <template x-for="(nodeId, idx) in job.activeNode" :key='idx'>
        <div class="text-blue-500" x-text="job.nodeDescriptionFromId(nodeId)"></div>
      </template>
      <template x-for="(error, idx) in job.errors" :key='idx'>
        <div class="text-red-500" x-text="error.nodeName +': '+ error.message"></div>
      </template>
      </div>`;
  }
}

export default OnmiJobRenderer;
