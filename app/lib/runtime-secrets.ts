import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function getRuntimeSecret(key: string): Promise<string | null> {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;

  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value?.trim() || null;
}

/** Returns a 503 response in production when secret is missing; null when OK to proceed. */
export function requireRuntimeSecretInProduction(
  secret: string | null | undefined,
  label: string,
  logTag?: string
): NextResponse | null {
  if (secret?.trim()) return null;
  if (!isProductionRuntime()) return null;

  console.error(`[${logTag || label}] ${label} not configured`);
  return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
}
