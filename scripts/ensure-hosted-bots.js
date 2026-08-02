const { PrismaClient } = require('@prisma/client');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

function killScript(scriptName) {
  if (process.platform === 'win32') {
    try { execSync(`wmic process where "CommandLine like '%${scriptName}%'" delete`, { stdio: 'ignore' }); } catch (e) {}
  } else {
    try { execSync(`pkill -f ${scriptName}`, { stdio: 'ignore' }); } catch (e) {}
  }
}

function spawnScript(scriptName, logFileName, processTitle) {
  const scriptPath = path.join(__dirname, scriptName);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[Hosted Bot Manager] ${scriptName} not found`);
    return;
  }

  const logDir = path.join(__dirname, '../data/logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, logFileName);
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  const child = spawn('node', [scriptPath], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOSTED_BOT_PROCESS_TITLE: processTitle },
  });
  child.unref();
  console.log(`[Hosted Bot Manager] Started ${scriptName} (log: ${logFile})`);
}

async function main() {
  if (process.env.SKIP_HOSTED_BOTS === '1' || process.env.SKIP_HOSTED_BOTS === 'true') {
    console.log('[Hosted Bot Manager] SKIP_HOSTED_BOTS set — skipping hosted bot daemons.');
    return;
  }

  console.log('[Hosted Bot Manager] Checking hosted bot daemons...');

  try {
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: { in: ['HOSTED_BRANDED_ENABLED', 'HOSTED_CUSTOM_MANAGER_ENABLED', 'HOSTED_BRANDED_BOT_TOKEN'] },
      },
    });
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));

    if (map.HOSTED_BRANDED_ENABLED === 'true' && map.HOSTED_BRANDED_BOT_TOKEN) {
      killScript('hosted-branded-bot.js');
      spawnScript('hosted-branded-bot.js', 'hosted-branded-bot.log', 'OpenSteam-Hosted-Branded-Bot');
    } else {
      killScript('hosted-branded-bot.js');
      console.log('[Hosted Bot Manager] Branded bot disabled or not configured.');
    }

    if (map.HOSTED_CUSTOM_MANAGER_ENABLED === 'true') {
      killScript('hosted-custom-bot-manager.js');
      spawnScript('hosted-custom-bot-manager.js', 'hosted-custom-bot.log', 'OpenSteam-Hosted-Custom-Manager');
    } else {
      killScript('hosted-custom-bot-manager.js');
      console.log('[Hosted Bot Manager] Custom bot manager disabled.');
    }
  } catch (err) {
    console.error('[Hosted Bot Manager] Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
