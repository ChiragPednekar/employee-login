"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "login" | "activate";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function routeByRole() {
    const { data } = await supabase
      .from("employees")
      .select("role")
      .limit(1)
      .maybeSingle();
    router.replace(data?.role === "admin" ? "/admin" : "/");
    router.refresh();
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
          ? "Wrong email or password. If this is your first time, use “First time here?” below to set your password."
          : error.message
      );
      setBusy(false);
      return;
    }
    await routeByRole();
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
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-3xl text-white shadow-lg">
            ⏱
          </div>
          <h1 className="text-2xl font-bold">WorkLog</h1>
          <p className="text-sm text-slate-500">
            {mode === "login"
              ? "Sign in to mark your attendance"
              : "First login — set your password"}
          </p>
        </div>

        <form
          onSubmit={mode === "login" ? handleLogin : handleActivate}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
        >
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {mode === "login" ? "Password" : "New password (min 8 characters)"}
            </label>
            <input
              type="password"
              required
              minLength={mode === "activate" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              placeholder="••••••••"
            />
          </div>
          {mode === "activate" && (
            <div>
              <label className="mb-1 block text-sm font-medium">Confirm password</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Set password & sign in"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "login" ? "activate" : "login");
            setError(null);
          }}
          className="mt-4 w-full text-center text-sm font-medium text-indigo-600 hover:underline"
        >
          {mode === "login"
            ? "First time here? Set your password →"
            : "← Already activated? Sign in"}
        </button>
      </div>
    </main>
  );
}
