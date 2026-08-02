import type { ReactNode } from "react";

/**
 * Same layered background as the fullscreen exam (`mod-assessment-shell`), but contained
 * for dashboard routes (not `position: fixed`).
 */
export default function ModAssessmentLandingChrome({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div className={`mod-assessment-landing-wrap ${className ?? ""}`}>
      <div className="mod-assessment-landing-ambient" aria-hidden />
      <div className="mod-assessment-landing-grid" aria-hidden />
      <div className="mod-assessment-landing-scan" aria-hidden />
      <div className={`relative z-10 ${innerClassName ?? ""}`}>{children}</div>
    </div>
  );
}
