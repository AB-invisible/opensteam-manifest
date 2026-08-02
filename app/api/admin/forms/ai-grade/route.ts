import { authOptions } from "@/app/lib/auth-options";
import { prisma } from "@/app/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { gradeApplicationAnswers } from "@/app/lib/application-ai-grade";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId },
  });

  if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const answersOrdered = body?.answersOrdered;

  if (!Array.isArray(answersOrdered) || answersOrdered.length === 0) {
    return NextResponse.json({ error: "answersOrdered is required" }, { status: 400 });
  }

  const { grades, modelLabel } = await gradeApplicationAnswers({
    answers: answersOrdered,
    maxScorePerQuestion: 10,
  });

  return NextResponse.json({
    ok: true,
    grades,
    modelLabel,
    maxScorePerQuestion: 10,
  });
}

