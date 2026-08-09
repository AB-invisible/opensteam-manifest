require('dotenv').config();
process.env.SKIP_ENSURE_BOT = process.env.SKIP_ENSURE_BOT || '1';
process.env.SKIP_HOSTED_BOTS = process.env.SKIP_HOSTED_BOTS || '1';
// Merged Render web service runs the Discord bot sidecar unless explicitly disabled.
process.env.RUN_DISCORD_BOT = process.env.RUN_DISCORD_BOT || '1';

const { startHttpKeepAlive } = require('./render-keepalive');
startHttpKeepAlive();

require('./start-cloud.js');
