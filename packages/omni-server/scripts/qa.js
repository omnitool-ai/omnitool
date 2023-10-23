/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const script = {
  name: 'qa',

  exec: async function (ctx, payload) {
    try {
      const dbService = ctx.app.services.get('db');
      let workflowIds;

      if (Array.isArray(payload) && payload.length > 0) {
        workflowIds = payload;
      } else {
          const demoWorkflows = await dbService.find({ 'meta.template': true }, ['id']);
      
          if (!demoWorkflows || demoWorkflows.length === 0) {
              throw new Error('No recipes found with "meta.template=true" flag in the database')
          }
      
          workflowIds = demoWorkflows.map(doc => doc.id);
      }
    
      workflowIds = workflowIds.filter(id => id !== 'c0deba5e-417d-49df-96d3-8aeb8fc15402'); //exclude bugbear

      if (!workflowIds.length) throw new Error('No workflowIds provided');

      const wfIntegration = ctx.app.integrations.get('workflow');
      const user = await dbService.get(`user:${ctx.userId}`);

      ctx.app.events.onAny((event, value) => {
        if (event.startsWith('jobs.')) {
          console.log('Received jobs event:', event, value);
        }
      });

      const workflowPromises = workflowIds.map(async (workflowId) => {
        console.log(`Starting recipe with ID: ${workflowId}`);
        try {
          const workflowName = (await dbService.get(`wf:${workflowId}`))?.meta?.name || 'Unknown';
          const jobResult = await wfIntegration.startWorkflow(wfIntegration, workflowId, ctx.session, user, {});

          if (jobResult.jobId) {
            return await new Promise((resolve, reject) => {
              let hasFinished = false;
              const timeoutTime = 60000;
              let timeout;
              let startTime = Date.now();

              const startTimeout = () => {
                startTime = Date.now(); // Record start time when job_started_ event is received
            
                timeout = setTimeout(() => {
                  if (!hasFinished) {
                    const duration = Math.round((Date.now() - startTime) / 1000); // Calculate and round the duration here
                    console.log(`Timeout as no job_finished event received for recipe ID: ${workflowId}. Timeout Time: ${timeoutTime / 1000} seconds. Duration: ${duration} seconds`);
                    // eslint-disable-next-line prefer-promise-reject-errors
                    reject({
                      status: 'timeout',
                      workflowId,
                      workflowName,
                      jobId: jobResult.jobId,
                      error: `Recipe Timeout reached as no job_finished event received within ${timeoutTime / 1000} seconds`
                    });
                  }
                }, timeoutTime);
              };
              // Setting up listener for job_started_ event to start the timeout timer
              ctx.app.events.once(`jobs.job_started_${jobResult.jobId}`).then(startTimeout);

              ctx.app.events.once(`jobs.job_finished_${jobResult.jobId}`)
                .then((jobs) => {
                  clearTimeout(timeout);
                  let job;
                  if (Array.isArray(jobs) && jobs.length > 0) {
                    job = jobs[0];
                  } else {
                    job = jobs;
                  }
                  const endTime = new Date(); // Record end time
                  const duration = Math.round((endTime - startTime) / 1000); // Calculate the duration
                  const errorDetails = job.errors.length ? JSON.stringify(job.errors) : 'None';
                  console.log(`Workflow ${workflowId} finished with jobState: ${job._state}. Job details:`, job);
                  if (job._state === 'success') {
                    resolve({
                      status: 'success',
                      workflowId,
                      workflowName,
                      jobId: jobResult.jobId,
                      jobState: job._state,
                      duration
                    });
                  } else {
                    // eslint-disable-next-line prefer-promise-reject-errors
                    reject({
                      status: 'fail',
                      workflowId,
                      workflowName,
                      jobId: jobResult.jobId,
                      jobState: job._state,
                      error: errorDetails,
                      duration
                    });
                  }
                  hasFinished = true;
                });
            });
          } else {
            throw new Error('Failed to start a job for the workflow');
          }
        } catch (error) {
          console.error(`Error in recipe ${workflowId}:`, error);
          return await Promise.reject(error);
        }
      })

      const results = await Promise.allSettled(workflowPromises);

      const report = '## QA Report\n' + results.map(result => {
        if (result.status === 'fulfilled') {
          return `#### ✅ ${result.value.workflowName}\n - **Workflow ID**: ${result.value.workflowId}\n - **Job ID**: ${result.value.jobId}\n - **Status**: ${result.status} ${result.value.status} ${result.value.jobState}\n  - **Error**: ${result.value.error || 'None'}\n - **Duration**: ${result.value.duration} s`;
        } else {
          return `#### ❌ ${result.reason.workflowName}\n - **Workflow ID**: ${result.reason.workflowId}\n - **Job ID**: ${result.reason.jobId}\n - **Status**: ${result.status} ${result.reason.status} ${result.reason.jobState}\n  - **Error**: ${result.reason?.error || 'None'}\n - **Duration**: ${result.reason.duration} s`;
        }
      }).join('\n');

      void await ctx.app.blocks.runBlock(
        ctx,
        'omnitool.write_document',
        { text: report, fileName: 'qa_report.md', textType: 'text/markdown', storageType: 'Temporary' }
      );
      void await ctx.app.blocks.runBlock(
        ctx,
        'omnitool.chat_output',
        { text: 'QA Report has been generated. Please check your file manager for the QA report.'}
      );
    } catch (error) {
      console.error('Error in QA script:', error);
      await ctx.app.sendMessageToSession(ctx.session.sessionId, error.message, 'text/plain');
      throw new Error(error.message);
    }
  },
};

export default script
