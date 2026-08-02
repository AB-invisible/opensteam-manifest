"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { TRIAL_MOD_DAYS, isTrialModPeriodActive } from "@/app/lib/moderator-trial";

type Action = "start" | "release-test" | "clear";

export type TrialModAppliedPayload = {
  action: Action;
  ok: boolean;
  message?: string;
  dmSent?: boolean;
  dmSkipped?: boolean;
  dmTokenUsed?: "primary" | "backup";
  emailSent?: boolean;
  dmWarning?: string;
};

type Props = {
  userId: string;
  discordId: string | null;
  trialModEndsAtIso: string | null;
  modTestReadyAtIso: string | null;
  /** Called after successful API response — parent can refresh `/api/admin/trial` + toasts. */
  onApplied?: (payload: TrialModAppliedPayload) => void;
};

export default function TrialModControls({
  userId,
  discordId,
  trialModEndsAtIso,
  modTestReadyAtIso,
  onApplied,
}: Props) {
  const [trialModEndsAt, setTrialModEndsAt] = useState<string | null>(trialModEndsAtIso);
  const [modTestReadyAt, setModTestReadyAt] = useState<string | null>(modTestReadyAtIso);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTrialModEndsAt(trialModEndsAtIso);
    setModTestReadyAt(modTestReadyAtIso);
  }, [trialModEndsAtIso, modTestReadyAtIso]);

  const runs = async (action: Action) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/trial-mods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId }),
      });
      const raw = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }

      const message = typeof data.message === "string" ? data.message : undefined;

      if (res.ok) {
        setTrialModEndsAt(typeof data.trialModEndsAt === "string" ? data.trialModEndsAt : null);
        setModTestReadyAt(typeof data.modTestReadyAt === "string" ? data.modTestReadyAt : null);

        const dmSent = data.dmSent === true;
        const dmSkipped = data.dmSkipped === true;
        const dmTokenUsed =
          data.dmTokenUsed === "primary" || data.dmTokenUsed === "backup"
            ? data.dmTokenUsed
            : undefined;
        const emailSent = data.emailSent === true;
        const dmWarning = typeof data.dmWarning === "string" ? data.dmWarning : undefined;

        onApplied?.({
          action,
          ok: true,
          dmSent,
          dmSkipped,
          dmTokenUsed,
          emailSent,
          dmWarning,
        });
      } else {
        alert(message ?? `Request failed (${res.status})`);
        onApplied?.({ action, ok: false, message });
      }
    } catch {
      alert("Request failed — check network.");
      onApplied?.({ action, ok: false, message: "network" });
    } finally {
      setLoading(false);
    }
  };

  const ends = trialModEndsAt ? new Date(trialModEndsAt) : null;
  const readyAtParsed = modTestReadyAt ? new Date(modTestReadyAt) : null;
  const trialActive = ends
    ? isTrialModPeriodActive({
        trialModEndsAt: ends,
        modTestReadyAt: readyAtParsed,
      })
    : false;

  let status = "—";
  if (modTestReadyAt) {
    status = "Test ready";
  } else if (trialActive && ends) {
    status = `Trial until ${ends.toLocaleString()}`;
  } else if (ends && ends <= new Date()) {
    status = "Trial ended (no test yet)";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-start" }}>
      <span style={{ fontSize: "0.72rem", color: "var(--muted-foreground)" }}>{status}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
        <button
          type="button"
          disabled={loading}
          onClick={() => runs("start")}
          title={`Start or reset a ${TRIAL_MOD_DAYS}-day moderator trial`}
          style={{
            padding: "0.2rem 0.45rem",
            fontSize: "0.65rem",
            borderRadius: "0.35rem",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            background: "rgba(59,130,246,0.2)",
            color: "#93c5fd",
          }}
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : null} Start trial
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => runs("release-test")}
          title={
            discordId
              ? "End trial now, mark test ready, notify via Discord DM and email"
              : "End trial now, mark test ready (no Discord ID — email only if available)"
          }
          style={{
            padding: "0.2rem 0.45rem",
            fontSize: "0.65rem",
            borderRadius: "0.35rem",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            background: "rgba(16,185,129,0.2)",
            color: "#6ee7b7",
          }}
        >
          Release test
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            if (confirm("Clear trial mod state for this user?")) runs("clear");
          }}
          title="Remove trial / test flags"
          style={{
            padding: "0.2rem 0.45rem",
            fontSize: "0.65rem",
            borderRadius: "0.35rem",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            background: "rgba(239,68,68,0.15)",
            color: "#fca5a5",
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
