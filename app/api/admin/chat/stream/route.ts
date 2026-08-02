import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { chatEmitter } from '@/app/lib/chat-events';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const caller = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string }
  });

  if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'MODERATOR' && caller.role !== 'SENIOR_MODERATOR' && caller.role !== 'OWNER')) {
    return new Response('Forbidden', { status: 403 });
  }

  const responseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Critical for Nginx/Proxies
  };

  const stream = new ReadableStream({
    start(controller) {
      const onMessage = (message: any) => {
        controller.enqueue(`data: ${JSON.stringify(message)}\n\n`);
      };

      chatEmitter.on('chat-message', onMessage);

      // Keep-alive every 20 seconds to prevent timeout
      const keepAlive = setInterval(() => {
        controller.enqueue(': keep-alive\n\n');
      }, 20000);

      // Handle close
      request.signal.addEventListener('abort', () => {
        chatEmitter.off('chat-message', onMessage);
        clearInterval(keepAlive);
      });
    }
  });

  return new Response(stream, { headers: responseHeaders });
}
