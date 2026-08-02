require('dotenv').config();
process.env.SKIP_ENSURE_BOT = process.env.SKIP_ENSURE_BOT || '1';
process.env.SKIP_HOSTED_BOTS = process.env.SKIP_HOSTED_BOTS || '1';

const path = require('path');
const { spawn } = require('child_process');

const { startHttpKeepAlive } = require('./render-keepalive');
startHttpKeepAlive();

// One Render web service = site + Discord bot (avoids a second slow Docker deploy).
console.log('[RenderWeb] Starting Discord bot sidecar...');
const bot = spawn(process.execPath, [path.join(__dirname, 'bot-daemon.js')], {
  stdio: 'inherit',
  env: process.env,
});
bot.on('exit', (code, signal) => {
  console.error(`[RenderWeb] bot-daemon exited (code=${code}, signal=${signal})`);
});

require('./start-cloud.js');
