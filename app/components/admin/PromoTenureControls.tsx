"use client";

import { useState } from "react";
import { Loader2, Clock, Search } from "lucide-react";

type RoleTenureRow = {
  roleId: string;
  label: string;
  days: number | null;
  since: string | null;
  removed: boolean;
  source: string | null;
  requiredDays?: number | null;
  meetsRequirement?: boolean | null;
};

type LookupResp = {
  discordId: string;
  username: string | null;
  platformRole: string | null;
  roles: RoleTenureRow[];
};

/** ADMIN/OWNER: manually force how many days a member has held a rank role (gates promotions). */
export default function PromoTenureControls() {
  const [discordId, setDiscordId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [days, setDays] = useState("");
  const [data, setData] = useState<LookupResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const lookup = async () => {
    const id = discordId.trim();
    if (!id) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/promo-tenure?discordId=${encodeURIComponent(id)}`);
      const j = (await res.json()) as LookupResp & { message?: string };
      if (!res.ok) throw new Error(j.message ?? "Lookup failed");
      setData(j);
      if (!roleId && j.roles[0]) setRoleId(j.roles[0].roleId);
    } catch (e) {
      setData(null);
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Lookup failed" });
    } finally {
      setLoading(false);
    }
  };

  const postTenure = async (id: string, role: string, value: number, okText: string) => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/promo-tenure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId: id, roleId: role, days: value }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? "Failed to set tenure");
      setMsg({ kind: "ok", text: okText.replace("{days}", String(j.days)) });
      await lookup();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to set tenure" });
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const id = discordId.trim();
    if (!id || !roleId || days.trim() === "") {
      setMsg({ kind: "err", text: "Discord ID, role, and days are all required." });
      return;
    }
    await postTenure(id, roleId, Number(days), "Set tenure to {days} day(s).");
  };

  // Force eligibility: bump tenure just past the requirement so the promotion exam unlocks now.
  const makeEligible = async () => {
    const id = discordId.trim();
    if (!id || !roleId) {
      setMsg({ kind: "err", text: "Discord ID and role are required." });
      return;
    }
    const selected = (data?.roles ?? []).find((r) => r.roleId === roleId);
    const required = selected?.requiredDays ?? null;
    if (required == null) {
      setMsg({ kind: "err", text: "This role doesn't unlock a promotion exam, so eligibility can't be granted from it." });
      return;
    }
    await postTenure(id, roleId, required + 1, "Eligible now — set tenure to {days} day(s).");
  };

  const roleOptions = data?.roles ?? [
    { roleId: "1484966440376467687", label: "Moderator", days: null, since: null, removed: false, source: null },
    { roleId: "1521098101715374190", label: "Senior Moderator", days: null, since: null, removed: false, source: null },
    { roleId: "1503424839422316574", label: "Head Moderator", days: null, since: null, removed: false, source: null },
  ];

  const selectedRole = (data?.roles ?? []).find((r) => r.roleId === roleId);
  const canMakeEligible = Boolean(selectedRole && selectedRole.requiredDays != null);

  return (
    <div className="mb-6 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Clock className="h-4 w-4 text-sky-300" />
        <h3 className="text-[11px] font-black uppercase tracking-widest text-sky-200">
          Force days on team (tenure override)
        </h3>
      </div>
      <p className="mb-3 max-w-prose text-[11px] leading-relaxed text-zinc-400">
        Manually set how many days a member has held a rank role. This overrides automatic tracking and is what promotion-exam
        eligibility checks against (e.g. 7 days as Moderator to attempt Senior). Setting a value{" "}
        <em className="text-zinc-300">below</em> the requirement (including <strong className="text-zinc-200">0</strong>) keeps
        them locked — use <strong className="text-sky-200">Make eligible now</strong> to unlock the exam instantly.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Discord ID</label>
          <input
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
            placeholder="123456789012345678"
            className="w-56 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
          />
        </div>
        <button
          type="button"
          onClick={lookup}
          disabled={loading || !discordId.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Look up
        </button>
      </div>

      {data ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-zinc-300">
          <span className="font-semibold text-white">{data.username ?? "Unknown user"}</span>
          {data.platformRole ? <span className="text-zinc-500"> · {data.platformRole}</span> : null}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {data.roles.map((r) => (
              <span key={r.roleId}>
                {r.label}:{" "}
                <strong className="text-zinc-200">
                  {r.removed ? "not held" : r.days != null ? `${r.days}d` : "—"}
                </strong>
                {r.requiredDays != null ? (
                  <span className={r.meetsRequirement ? "text-emerald-400" : "text-amber-400"}>
                    {" "}
                    / need {r.requiredDays}d{r.meetsRequirement ? " ✓" : ""}
                  </span>
                ) : null}
                {r.source ? <span className="text-zinc-600"> ({r.source})</span> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Role</label>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
          >
            <option value="">Select role…</option>
            {roleOptions.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Days</label>
          <input
            type="number"
            min={0}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="14"
            className="w-28 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !discordId.trim() || !roleId || days.trim() === ""}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/40 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Set tenure
        </button>
        <button
          type="button"
          onClick={makeEligible}
          disabled={saving || !discordId.trim() || !roleId || !canMakeEligible}
          title={
            canMakeEligible
              ? "Set tenure just past the requirement so the promotion exam unlocks now"
              : "Look up the user, then pick a role that unlocks a promotion (Moderator or Senior Moderator)"
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-xs font-bold uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Make eligible now
        </button>
      </div>

      {msg ? (
        <p className={`mt-3 text-xs ${msg.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>
      ) : null}
    </div>
  );
}
