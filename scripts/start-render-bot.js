require('dotenv').config();

const { startRenderHealthServer } = require('./render-health-server');
startRenderHealthServer();

require('./bot-daemon.js');
