require('dotenv').config();
process.env.SKIP_ENSURE_BOT = process.env.SKIP_ENSURE_BOT || '1';
process.env.SKIP_HOSTED_BOTS = process.env.SKIP_HOSTED_BOTS || '1';
process.env.RUN_DISCORD_BOT = process.env.RUN_DISCORD_BOT || '1';

const { startHttpKeepAlive } = require('./render-keepalive');
startHttpKeepAlive();

require('./start-cloud.js');
