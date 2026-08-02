import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import PromoTestExam from "@/app/components/promo-test/PromoTestExam";
import { authOptions } from "@/app/lib/auth-options";

export default async function PromoTestPage() {
  const session = await getServerSession(authOptions);
  const discordId = (session?.user as { discordId?: string } | undefined)?.discordId;
  if (!session?.user || !discordId) {
    redirect("/auth/signin?callbackUrl=/dashboard/promo-test");
  }

  return (
    <div className="animate-fade-in min-h-[60vh]">
      <PromoTestExam />
    </div>
  );
}
