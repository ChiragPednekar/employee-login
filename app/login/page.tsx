"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BriefcaseBusiness, Lock, Eye, EyeOff, ShieldCheck, LoaderCircle } from "lucide-react";
import { FieldLabel, inputCls } from "@/components/ui";

type Mode = "login" | "activate";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 2FA challenge step
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  async function routeByRole() {
    const { data } = await supabase
      .from("employees")
      .select("role")
      .limit(1)
      .maybeSingle();
    const role = data?.role;
    router.replace(role === "admin" ? "/admin" : role === "audit" ? "/audit" : "/");
    router.refresh();
  }

  // After a password sign-in, step up to 2FA if the account has a verified factor.
  async function continueAfterPassword() {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp =
        factors?.totp?.find((f) => f.status === "verified") ?? factors?.totp?.[0];
      if (totp) {
        setMfaFactorId(totp.id);
        setBusy(false);
        return;
      }
    }
    await routeByRole();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Wrong email or password. First time here? Use “Set password” below."
          : error.message
      );
      setBusy(false);
      return;
    }
    await continueAfterPassword();
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setError(null);
    setBusy(true);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: mfaFactorId,
    });
    if (chErr || !ch) {
      setBusy(false);
      setError(chErr?.message ?? "Could not start the 2FA challenge.");
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: ch.id,
      code: mfaCode.trim(),
    });
    if (vErr) {
      setBusy(false);
      setError("That code didn't match. Try the current code from your authenticator.");
      return;
    }
    await routeByRole();
  }

  async function cancelMfa() {
    await supabase.auth.signOut();
    setMfaFactorId(null);
    setMfaCode("");
    setPassword("");
    setError(null);
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("activate-account", {
      body: { email: email.trim().toLowerCase(), password },
    });
    if (error) {
      let msg = "Could not activate the account.";
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) msg = body.error;
      } catch {}
      setError(msg);
      setBusy(false);
      return;
    }
    if (data?.ok) {
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (loginErr) {
        setError(loginErr.message);
        setBusy(false);
        return;
      }
      await routeByRole();
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-white p-4 md:p-6">
      <div className="flex w-full max-w-[440px] flex-col items-center">
        {/* Branding anchor */}
        <header className="mb-10 text-center">
          <div className="mb-4 flex items-center justify-center">
            <BriefcaseBusiness size={48} className="text-primary" strokeWidth={2} />
          </div>
          <h1 className="text-[32px] font-extrabold leading-10 tracking-tight text-ink">
            WorkLog
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Location-based Attendance &amp; Leave
          </p>
        </header>

        {/* Authentication card */}
        <section className="w-full rounded-lg border border-line bg-white p-8">
          {mfaFactorId ? (
            <form onSubmit={handleMfa} className="space-y-5">
              <div className="text-center">
                <p className="text-sm font-semibold text-ink">Two-factor authentication</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </div>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="h-12 w-full rounded-lg border border-line-strong bg-white text-center font-mono text-xl tracking-[0.4em] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {error && (
                <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || mfaCode.length !== 6}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? <LoaderCircle size={17} className="animate-spin" /> : <ShieldCheck size={16} />}
                Verify
              </button>
              <button
                type="button"
                onClick={cancelMfa}
                className="w-full text-center text-sm font-medium text-ink-muted hover:underline"
              >
                Cancel
              </button>
            </form>
          ) : (
          <>
          <form
            onSubmit={mode === "login" ? handleLogin : handleActivate}
            className="space-y-6"
          >
            <div className="space-y-1">
              <FieldLabel htmlFor="email">Email Address</FieldLabel>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="name@company.com"
              />
            </div>

            <div className="space-y-1">
              <FieldLabel htmlFor="password">
                {mode === "login" ? "Password" : "New password (min 8 characters)"}
              </FieldLabel>
              <div className="relative">
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  required
                  minLength={mode === "activate" ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pr-10`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted transition-colors hover:text-primary"
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {mode === "activate" && (
              <div className="space-y-1">
                <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                <input
                  id="confirm"
                  type={showPass ? "text" : "password"}
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white transition-all duration-100 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? (
                <>
                  <LoaderCircle size={17} className="animate-spin" />
                  {mode === "login" ? "Signing in…" : "Setting password…"}
                </>
              ) : (
                <>
                  <Lock size={16} />
                  {mode === "login" ? "Sign In" : "Set password & sign in"}
                </>
              )}
            </button>
          </form>

          {/* Secondary action */}
          <div className="mt-8 border-t border-line pt-6 text-center">
            <p className="mb-3 text-[13px] text-ink-muted">
              {mode === "login" ? "New to WorkLog?" : "Already activated?"}
            </p>
            <button
              onClick={() => {
                setMode(mode === "login" ? "activate" : "login");
                setError(null);
              }}
              className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-outline text-xs font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-surface-low"
            >
              {mode === "login" ? "First-time user: Set password" : "Back to sign in"}
            </button>
          </div>
          </>
          )}
        </section>

        {/* Footer */}
        <footer className="mt-8 space-y-2 text-center">
          <div className="flex items-center justify-center gap-1.5 text-ink-muted">
            <ShieldCheck size={15} />
            <span className="text-xs font-medium tracking-wide">
              SECURE ENCRYPTED SESSION
            </span>
          </div>
          <p className="text-[13px] text-outline">
            © {new Date().getFullYear()} WorkLog. All rights reserved.
          </p>
        </footer>
      </div>
    </main>
  );
}
