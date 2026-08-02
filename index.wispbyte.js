/**
 * Wispbyte default egg runs: node /home/container/${JS_FILE}
 * Set JS_FILE=index.js in Startup (or use startup command: npm start).
 */
require('dotenv').config();

const path = require('path');
const { spawnSync } = require('child_process');

const wait = spawnSync(process.execPath, [path.join(__dirname, 'scripts/wait-for-db.js')], {
  stdio: 'inherit',
  env: process.env,
});
if (wait.status !== 0) {
  console.warn('[index] wait-for-db exited with code', wait.status);
}

require('./scripts/bot-daemon.js');
