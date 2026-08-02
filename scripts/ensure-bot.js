const { PrismaClient } = require('@prisma/client');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

async function main() {
  if (process.env.SKIP_ENSURE_BOT === '1' || process.env.SKIP_ENSURE_BOT === 'true') {
    console.log('[Bot Manager] SKIP_ENSURE_BOT set — bot runs as a separate service.');
    return;
  }

  console.log('[Bot Manager] Checking desired bot state...');
  
  // If running under PM2, PM2 manages manifest-bot via ecosystem.config.js
  if (process.env.pm_id !== undefined || process.env.PM2_HOME !== undefined || process.env.ecosystem) {
    console.log('[Bot Manager] PM2 process manager detected. Skipping duplicate bot spawn.');
    return;
  }

  try {
    const enabledCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_ENABLED' } });
    const isEnabled = enabledCfg?.value === 'true';

    if (!isEnabled) {
      console.log('[Bot Manager] Bot is disabled in settings. Skipping auto-start.');
      return;
    }

    console.log('[Bot Manager] Bot is enabled. Ensuring it is running...');

    // Kill any existing instances to avoid ghost bots
    if (process.platform === 'win32') {
       try {
         const pidFile = path.join(__dirname, '../data/bot.pid');
         if (fs.existsSync(pidFile)) {
           const pid = fs.readFileSync(pidFile, 'utf8').trim();
           if (pid) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
         }
       } catch (e) {}
        try {
          const psCmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'node.exe\' -and $_.CommandLine -like \'*bot-daemon.js*\' } | Select-Object -ExpandProperty ProcessId"';
          const pids = execSync(psCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).map(p => p.trim()).filter(Boolean);
          pids.forEach(pid => {
            if (pid && Number(pid) !== process.pid) {
              try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (_) {}
            }
          });
        } catch (e) {}
    } else {
       try { execSync('pkill -f scripts/bot-daemon.js', { stdio: 'ignore' }); } catch(e){}
    }

    const scriptPath = path.join(__dirname, 'bot-daemon.js');
    if (!fs.existsSync(scriptPath)) {
      console.error('[Bot Manager] bot-daemon.js not found at:', scriptPath);
      return;
    }

    const logDir = path.join(__dirname, '../data/logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'bot.log');
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    console.log('[Bot Manager] Spawning bot daemon (Logging to: ' + logFile + ')');
    const botProcess = spawn('node', [scriptPath], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: path.join(__dirname, '..'),
      env: { ...process.env }
    });

    botProcess.unref();
    console.log('[Bot Manager] Bot auto-started successfully.');

  } catch (err) {
    console.error('[Bot Manager] Critical error during auto-start:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
