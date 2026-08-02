/**
 * Edge-compatible logging helper for Better Stack.
 *
 * This module uses a plain `fetch()` call instead of the OpenTelemetry SDK so
 * it can safely be imported from Next.js middleware (Edge Runtime), where
 * packages like @grpc/grpc-js are forbidden.
 */

const BETTER_STACK_OTLP_LOGS_URL = 'https://s2426449.eu-fsn-3.betterstackdata.com/v1/logs';
const BETTER_STACK_TOKEN = '6Ak5EXsL2bqieDeacAacMzgH';

/**
 * Fire-and-forget log to Better Stack via the OTLP/HTTP JSON protocol.
 * Safe to call from Edge Runtime (middleware) and Node.js alike.
 */
export function logToBetterStack(
  message: string,
  level: 'INFO' | 'WARN' | 'ERROR' = 'INFO',
  attributes: Record<string, any> = {},
) {
  const severityNumber = level === 'ERROR' ? 17 : level === 'WARN' ? 13 : 9;

  const body = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'OpenSteam' } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'opensteam-edge-logger' },
            logRecords: [
              {
                timeUnixNano: String(Date.now() * 1_000_000),
                severityNumber,
                severityText: level,
                body: { stringValue: message },
                attributes: Object.entries(attributes).map(([key, val]) => ({
                  key,
                  value: { stringValue: String(val) },
                })),
              },
            ],
          },
        ],
      },
    ],
  };

  // Fire-and-forget — intentionally not awaited so the middleware is never
  // blocked on the logging call.
  fetch(BETTER_STACK_OTLP_LOGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BETTER_STACK_TOKEN}`,
    },
    body: JSON.stringify(body),
  }).catch(() => {
    /* swallow errors — logging must never break the request */
  });
}
