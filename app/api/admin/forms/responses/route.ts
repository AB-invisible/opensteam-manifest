import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getFormResponses } from '@/app/lib/google-forms'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const searchParams = request.nextUrl.searchParams
  const formId = searchParams.get('formId') || '17zWGbRUjIVxZTtha80EfDlDQFqyHZj46xDBBxDTaoGk'

  try {
    const data = await getFormResponses(formId)
    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[Forms API Error]', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch form responses' }, { status: 500 })
  }
}
