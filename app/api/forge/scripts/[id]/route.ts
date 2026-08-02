import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/app/lib/prisma';
import { authOptions } from '@/app/lib/auth-options';
import { writeUserData, deleteUserData } from '@/app/lib/storage';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { name, description, content, isPublic, language } = await req.json();
    const scriptId = params.id;

    const script = await prisma.extensionScript.findUnique({
      where: { id: scriptId },
    });

    if (!script) {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }

    if (script.authorId !== (session.user as any).id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updatedScript = await prisma.extensionScript.update({
      where: { id: scriptId },
      data: {
        name: name ?? script.name,
        description: description ?? script.description,
        content: content ?? script.content,
        isPublic: isPublic ?? script.isPublic,
        language: language ?? script.language,
      },
    });

    // Sync to local volume /data
    if (content) {
      writeUserData(`${updatedScript.id}.js`, content, 'scripts')
    }

    return NextResponse.json({ script: updatedScript });
  } catch (error) {
    console.error('Update script error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const scriptId = params.id;
    const script = await prisma.extensionScript.findUnique({
      where: { id: scriptId },
    });

    if (!script) {
      return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    }

    if (script.authorId !== (session.user as any).id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.extensionScript.delete({
      where: { id: scriptId },
    });

    // Delete from local volume
    deleteUserData(`${scriptId}.js`, 'scripts')

    return NextResponse.json({ message: 'Script deleted successfully' });
  } catch (error) {
    console.error('Delete script error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
