import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import ModAssessmentExam from "@/app/components/mod-assessment/ModAssessmentExam";
import { authOptions } from "@/app/lib/auth-options";

export default async function ModAssessmentPage() {
  const session = await getServerSession(authOptions);
  const discordId = (session?.user as { discordId?: string } | undefined)?.discordId;
  if (!session?.user || !discordId) {
    redirect("/auth/signin?callbackUrl=/dashboard/mod-assessment");
  }

  return (
    <div className="animate-fade-in min-h-[60vh]">
      <ModAssessmentExam />
    </div>
  );
}
