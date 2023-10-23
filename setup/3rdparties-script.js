const { spawn } = require('child_process');
const fs = require('fs');
const fsPromises = fs.promises;

// Check if .fossa.yml exists
if (!fs.existsSync('.fossa.yml')) {
  console.warn('.fossa.yml does not exist!');
}

// Function to execute a command and stream the output
function execute(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: [process.stdin, process.stdout, process.stderr] });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

// Run fossa analyze
execute('fossa', ['analyze'])
  .then(() => {
    // Run fossa report and redirect output to THIRD_PARTIES.md
    return new Promise((resolve, reject) => {
      console.log("Generating THIRD_PARTIES.md");
      const report = spawn('fossa', ['report', 'attribution', '--format', 'markdown']);
      const fileStream = fs.createWriteStream('THIRD_PARTIES.md');
      report.stdout.pipe(fileStream);
      report.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`fossa report exited with code ${code}`));
        } else {
          console.log('THIRD_PARTIES.md has been generated');
          resolve();
        }
      });
    });
  })
  .catch((error) => {
    console.error(error);
  });
