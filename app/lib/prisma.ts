import { PrismaClient } from '@prisma/client'
import { pingHeartbeat, startHeartbeatInterval } from './heartbeat'

const globalForPrisma = globalThis as unknown as {
  prismaClient: PrismaClient | undefined
}

/**
 * Build a DATABASE_URL with safe pool settings.
 * - connection_limit=3  : max 3 connections per Next.js process (Railway proxy caps hard)
 * - pool_timeout=15     : wait up to 15s for a free slot before erroring
 * - connect_timeout=10  : give up connecting after 10s
 * - pgbouncer=true      : Prisma skips SET commands that break transaction-mode PgBouncer
 * - statement_cache_size=0 : disable prepared-statement cache (required with PgBouncer)
 */
function buildDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const base = raw.replace(/\?.*$/, '');
  return `${base}?connection_limit=3&pool_timeout=15&connect_timeout=10&pgbouncer=true&statement_cache_size=0`;
}

const prismaClient = globalForPrisma.prismaClient ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasourceUrl: buildDatasourceUrl(),
})

globalForPrisma.prismaClient = prismaClient

// Release connections cleanly when the process exits (avoids lingering idle slots)
if (typeof process !== 'undefined') {
  const disconnect = () => { prismaClient.$disconnect().catch(() => {}); };
  process.once('beforeExit', disconnect);
  process.once('SIGTERM',    disconnect);
  process.once('SIGINT',     disconnect);
}

// Initialize background heartbeat monitoring
startHeartbeatInterval();

// Database Robustness Extension: Automatically retries when DB is starting up
export const prisma = prismaClient.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const MAX_RETRIES = 5;
        const INITIAL_DELAY = 1000;

        for (let i = 0; i < MAX_RETRIES; i++) {
          try {
            const result = await query(args);
            // Ping database heartbeat on success (throttled)
            pingHeartbeat('database');
            return result;
          } catch (error: any) {
            const errorMessage = error.message || '';
            const isTransientError =
              errorMessage.includes('database system is starting up') ||
              errorMessage.includes("Can't reach database server") ||
              errorMessage.includes('Connection terminated unexpectedly');
            // NOTE: 'too many clients/connections' is intentionally NOT retried here.
            // Retrying pool-exhaustion errors amplifies the problem by holding connections
            // longer. The connection_limit on the PrismaClient URL caps per-process usage.

            if (isTransientError && i < MAX_RETRIES - 1) {
              const delay = INITIAL_DELAY * Math.pow(2, i);
              console.warn(`[Prisma Retry] ${model}.${operation} failed. Retrying in ${delay}ms... (Attempt ${i + 1}/${MAX_RETRIES})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw error;
          }
        }
      },
    },
  },
})
