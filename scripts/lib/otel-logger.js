const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { LoggerProvider, SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { logs } = require('@opentelemetry/api-logs');

const BETTER_STACK_OTLP_LOGS_URL = 'https://s2426449.eu-fsn-3.betterstackdata.com/v1/logs';
const BETTER_STACK_TOKEN = '6Ak5EXsL2bqieDeacAacMzgH';

const resource = resourceFromAttributes({
  [SemanticResourceAttributes.SERVICE_NAME]: 'OpenSteam',
});

// Configure Log Exporter
const logExporter = new OTLPLogExporter({
  url: BETTER_STACK_OTLP_LOGS_URL,
  headers: {
    Authorization: `Bearer ${BETTER_STACK_TOKEN}`,
  },
});

// Initialize Logger Provider
const loggerProvider = new LoggerProvider({ 
  resource,
  processors: [new SimpleLogRecordProcessor(logExporter)]
});

// Global registration
logs.setGlobalLoggerProvider(loggerProvider);

const sdk = new NodeSDK({
  resource,
  logRecordProcessors: [new SimpleLogRecordProcessor(logExporter)],
});

function startOtel() {
  sdk.start();
  console.log('[OTEL] OpenTelemetry SDK started for OpenSteam (Bot Daemon)');
}

function logToBetterStack(message, level = 'INFO', attributes = {}) {
  const logger = logs.getLogger('gamegen-bot-logger');
  logger.emit({
    body: message,
    severityText: level,
    severityNumber: level === 'ERROR' ? 17 : level === 'WARN' ? 13 : 9,
    attributes: {
      ...attributes,
      'service.name': 'OpenSteam',
      'source': 'bot-daemon'
    },
  });
}

module.exports = {
  startOtel,
  logToBetterStack
};
