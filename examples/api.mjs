// Description: This example shows how to run a recipe using the Omni API
// Usage: node api.mjs

import * as util from 'util';

const OMNI_SERVER_URL = "http://127.0.0.1:1688"        // The omni server url
const recipeId = "324a4e58-4240-46a7-86f4-59ea9598fc99" // Id of the recipe you want to run 
const interval = 1000 * 5                               // Polling interval for job results 

// JWT Token to run the recipe generated with the following command in chat:
//   /generateJWTtoken exec Workflow <recipeId> <expirationInSeconds>
//
//   Example:
//     /generateJWTtoken exec Workflow e5507eee-5ba7-4fea-85c4-c38dbb0fa43e 2592000
const token = '- YOUR TOKEN HERE -'


let progressChars = ['|', '/', '-', '\\'];
let progressIndex = 0;


async function doFetch(url, token, method = 'GET', payload) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const fetchOptions = {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined
  };

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    console.error(`HTTP error! status: ${response.status} for url: ${url}`);
    throw new Error(`HTTP error! status: ${response.status} for url: ${url}`);
  }
  return response.json();
}



async function runRecipe() {
  const payload =
  {
    workflow: recipeId,
    args: {
      text: "A horse"

    },
  }
  const start = await doFetch(`${OMNI_SERVER_URL}/api/v1/workflow/exec`, token, 'POST', payload)
  const jobId = start.result.jobId
 
  console.log('job start', start)
  // wait for a few ms
  let finished = false

  const progressInterval = setInterval(() => {
    process.stdout.write('\r' + progressChars[progressIndex++ % progressChars.length] + ' Waiting for job to complete...');
  }, 100); // Update every 100ms for a smoother animation

  while (!finished) {
    let status = await doFetch(`${OMNI_SERVER_URL}/api/v1/workflow/jobs`, token, 'GET')
    const job = status.jobs.find(job => job.id === jobId)

    if (!job || job.state !== 'running') {
      finished = true
      clearInterval(progressInterval);                                // Stop the progress indicator
      process.stdout.write('\rJob completed.                    \n'); // Clear the progress indicator
    }
    else {
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  let result = await doFetch(`${OMNI_SERVER_URL}/api/v1/workflow/results?jobId=${jobId}`, token, 'GET')
  console.log(util.inspect(result, { showHidden: false, depth: null, colors: true }));
}

runRecipe()

