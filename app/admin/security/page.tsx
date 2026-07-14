"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
import { ShieldCheck, ShieldAlert, Smartphone, Copy, Check } from "lucide-react";

type Factor = { id: string; status: string; friendly_name?: string | null };

export default function SecurityPage() {
  const supabase = supabaseBrowser();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enrollment state
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp as Factor[]) ?? []);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const verified = factors.find((f) => f.status === "verified");

  async function startEnroll() {
    setBusy(true);
    setError(null);
    // Clean up any earlier unverified factor so re-enrolling doesn't pile up
    const stale = factors.find((f) => f.status === "unverified");
    if (stale) await supabase.auth.mfa.unenroll({ factorId: stale.id });

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? "Could not start enrollment");
      return;
    }
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    setError(null);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: enroll.factorId,
    });
    if (chErr || !ch) {
      setBusy(false);
      setError(chErr?.message ?? "Challenge failed");
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: enroll.factorId,
      challengeId: ch.id,
      code: code.trim(),
    });
    setBusy(false);
    if (vErr) {
      setError("That code didn't match. Check your authenticator and try again.");
      return;
    }
    setEnroll(null);
    setCode("");
    refresh();
  }

  async function disable() {
    if (!verified) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    refresh();
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Security</h1>
        <p className="text-xs text-ink-muted">Two-factor authentication for your admin account</p>
      </div>

      {!loaded ? (
        <p className="p-6 text-center text-sm text-ink-muted">Loading…</p>
      ) : verified && !enroll ? (
        <Card featured className="p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success-tint text-success">
              <ShieldCheck size={20} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">Two-factor authentication is on</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                You&apos;ll be asked for a 6-digit code from your authenticator app each time you
                sign in.
              </p>
              <button
                onClick={disable}
                disabled={busy}
                className="mt-4 h-9 rounded-lg border border-line-strong px-3.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-tint disabled:opacity-50"
              >
                {busy ? "…" : "Turn off 2FA"}
              </button>
            </div>
          </div>
        </Card>
      ) : enroll ? (
        <Card className="p-6">
          <p className="text-sm font-semibold text-ink">Scan this QR code</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Use Google Authenticator, Authy, 1Password, or any TOTP app.
          </p>
          <div className="mt-4 flex flex-col items-center gap-3">
            {/* qr_code is an SVG data URI from Supabase */}
            <Image
              src={enroll.qr}
              alt="2FA QR code"
              width={192}
              height={192}
              unoptimized
              className="h-48 w-48 rounded-lg border border-line"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(enroll.secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-surface-low px-3 py-1.5 font-mono text-xs text-ink-muted"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {enroll.secret}
            </button>
          </div>
          <form onSubmit={confirmEnroll} className="mt-5 space-y-3">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Enter the 6-digit code
            </label>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="h-12 w-full rounded-lg border border-line-strong bg-white text-center font-mono text-xl tracking-[0.4em] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            {error && (
              <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEnroll(null)}
                className="h-11 flex-1 rounded-lg border border-line-strong text-sm font-semibold text-ink transition-colors hover:bg-surface-low"
              >
                Cancel
              </button>
              <button
                disabled={busy || code.length !== 6}
                className="h-11 flex-1 rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {busy ? "Verifying…" : "Verify & enable"}
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <ShieldAlert size={20} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">Two-factor authentication is off</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Admin accounts can access attendance and payroll-adjacent data. Adding a second
                factor protects it if your password is ever leaked.
              </p>
              {error && (
                <p className="mt-3 rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">
                  {error}
                </p>
              )}
              <button
                onClick={startEnroll}
                disabled={busy}
                className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                <Smartphone size={16} />
                {busy ? "…" : "Set up 2FA"}
              </button>
            </div>
          </div>
        </Card>
      )}
    </main>
  );
}
