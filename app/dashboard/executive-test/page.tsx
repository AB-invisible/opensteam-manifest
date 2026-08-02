import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import ExecutiveTestExam from "@/app/components/executive-test/ExecutiveTestExam";
import { authOptions } from "@/app/lib/auth-options";

export default async function ExecutiveTestPage() {
  const session = await getServerSession(authOptions);
  const discordId = (session?.user as { discordId?: string } | undefined)?.discordId;
  if (!session?.user || !discordId) {
    redirect("/auth/signin?callbackUrl=/dashboard/executive-test");
  }

  return (
    <div className="animate-fade-in min-h-[60vh]">
      <ExecutiveTestExam />
    </div>
  );
}
