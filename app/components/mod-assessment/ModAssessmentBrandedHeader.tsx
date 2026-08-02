import Image from "next/image";
import { MOD_ASSESSMENT_BRAND } from "@/app/lib/mod-assessment-brand";

export default function ModAssessmentBrandedHeader({
  className,
  compact,
}: {
  className?: string;
  /** When true, tighter type for the in-experience header above the live paper. */
  compact?: boolean;
}) {
  return (
    <header
      className={`flex flex-row items-start justify-between gap-4 ${className ?? ""}`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={
            compact
              ? "text-[0.7rem] font-black leading-tight tracking-tight text-white sm:text-xs"
              : "text-sm font-black leading-tight tracking-tight text-white sm:text-base"
          }
        >
          {MOD_ASSESSMENT_BRAND.primaryLine}
        </p>
        <p
          className={
            compact
              ? "mt-0.5 text-[0.65rem] font-bold text-white sm:text-[0.7rem]"
              : "mt-1 text-xs font-bold text-white sm:text-sm"
          }
        >
          {MOD_ASSESSMENT_BRAND.handbookLine}
        </p>
        <p
          className={
            compact
              ? "mt-0.5 max-w-md text-[9px] leading-snug text-zinc-400 sm:text-[10px]"
              : "mt-1 max-w-md text-[10px] leading-snug text-zinc-400 sm:text-[11px]"
          }
        >
          {MOD_ASSESSMENT_BRAND.assessmentLine}
        </p>
        <div
          className={`h-px w-full bg-gradient-to-r from-white/20 via-white/10 to-transparent ${compact ? "mt-3" : "mt-4"}`}
          aria-hidden
        />
      </div>
      <div className="shrink-0">
        <div className="relative h-12 w-12 overflow-hidden rounded-full border border-white/15 bg-black/40 shadow-[0_0_36px_-8px_rgba(99,102,241,0.4)] sm:h-14 sm:w-14">
          <Image
            src="/opensteam.png"
            alt=""
            width={112}
            height={112}
            className="h-full w-full object-cover"
            priority
          />
        </div>
      </div>
    </header>
  );
}
