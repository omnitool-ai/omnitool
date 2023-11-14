const { execSync } = require('node:child_process');

async function fix_python312_distutils() {
  console.log('Checking if python3.12 is installed...');
  // validate python3.12 is installed
  const python312 = execSync('python3.12 --version').toString().trim();
  console.log()
  const result = python312.split(' ');
  const version = result[1];
  const versionParts = version.split('.');
  if (versionParts[0] !== '3' || versionParts[1] !== '12') {
    // nothing to do
    console.log('Not required. Continuing...');
    return;
  }
  console.log('python3.12 is installed. Attempting to install setuptools...');
  execSync('python -m pip install setuptools', { stdio: 'inherit' });
}

async function run() {
  await fix_python312_distutils();
  console.log('\nAttempted fix Done! Please run "yarn" again followed by "yarn start"');
}

run();