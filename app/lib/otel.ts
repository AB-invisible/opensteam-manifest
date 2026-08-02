import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { logs } from '@opentelemetry/api-logs';

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

export const sdk = new NodeSDK({
  resource,
  logRecordProcessors: [new SimpleLogRecordProcessor(logExporter)],
});

// Start the SDK
export function startOtel() {
  if (process.env.NODE_ENV === 'production') {
    sdk.start();
    console.log('[OTEL] OpenTelemetry SDK started for OpenSteam');
  }
}

/**
 * Helper to log messages to Better Stack
 */
export function logToBetterStack(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO', attributes: Record<string, any> = {}) {
  const logger = logs.getLogger('opensteam-logger');
  logger.emit({
    body: message,
    severityText: level,
    severityNumber: level === 'ERROR' ? 17 : level === 'WARN' ? 13 : 9,
    attributes: {
      ...attributes,
      'service.name': 'OpenSteam',
    },
  });
}
