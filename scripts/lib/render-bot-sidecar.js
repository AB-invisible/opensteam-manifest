const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let botProcess = null;
let restartTimer = null;

function shouldRunDiscordBotSidecar() {
  if (process.env.SKIP_DISCORD_BOT === '1' || process.env.RUN_DISCORD_BOT === '0') return false;
  return !!(process.env.RENDER_EXTERNAL_URL || process.env.RENDER || process.env.RUN_DISCORD_BOT === '1');
}

function startDiscordBotSidecar() {
  if (!shouldRunDiscordBotSidecar()) return;

  const botScript = path.join(__dirname, '..', 'bot-daemon.js');

  const launch = () => {
    if (botProcess) return;
    console.log('[RenderBot] Starting Discord bot sidecar...');
    botProcess = spawn(process.execPath, [botScript], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BOT_PID_FILE: process.env.BOT_PID_FILE || '/tmp/opensteam-bot.pid',
      },
    });

    // Touch a log marker so status checks can detect recent bot activity on Render.
    try {
      const logDir = path.join(process.cwd(), 'data', 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'bot.log'), `[RenderBot] sidecar started at ${new Date().toISOString()}\n`, { flag: 'a' });
    } catch (_) {}

    botProcess.on('exit', (code, signal) => {
      botProcess = null;
      console.error(`[RenderBot] bot-daemon exited (code=${code}, signal=${signal})`);
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(launch, 10_000);
    });
  };

  launch();
}

module.exports = { startDiscordBotSidecar };
