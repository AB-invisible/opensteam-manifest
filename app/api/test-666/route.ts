import { NextResponse } from 'next/server';

export function GET() {
  const res = NextResponse.json({ error: 'test' }, { status: 400 });
  Object.defineProperty(res, 'status', { get: () => 666 });
  return res;
}
