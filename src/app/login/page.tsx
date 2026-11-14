
"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Hourglass, ShieldCheck, Sparkles } from "lucide-react";

function getLoginEmail(identifier: string) {
  const value = identifier.trim();

  // Admin accounts continue to use their real email addresses.
  if (value.includes("@")) return value;

  // Team accounts use their generated internal email.
  const username = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${username.toLowerCase()}@teams.daemonhour.invalid`;
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInWithPassword({
        email: getLoginEmail(identifier),
        password,
      });

      if (error) {
        throw new Error("Invalid username/email or password.");
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to sign in."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="hourglass-grid relative min-h-screen overflow-hidden bg-[#05070d] p-4 text-white sm:p-7">
      <div className="pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-[30rem] w-[30rem] rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="relative mx-auto grid min-h-[calc(100vh-56px)] max-w-6xl overflow-hidden rounded-[30px] border border-white/10 bg-[#0b101b] shadow-2xl lg:grid-cols-[1.1fr_.9fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 bg-[#080d17] p-12 lg:flex">
          <div
            className="absolute inset-0 bg-cover bg-[center_35%] opacity-25"
            style={{ backgroundImage: "url('/daemon-hour-poster.png')" }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-[#07101d]/80 via-[#07101d]/55 to-[#07101d]/90" />

          <div className="relative flex items-center gap-3">
            <div className="rounded-2xl border border-sky-200/30 bg-sky-300/10 p-3 text-sky-200 shadow-[0_0_28px_rgba(83,165,255,.2)]">
              <Hourglass size={27} />
            </div>
            <div>
              <div className="text-lg font-black tracking-[.2em]">
                DAEMON HOUR
              </div>
              <div className="mt-1 text-[10px] tracking-[.24em] text-sky-200/60">
                AUCTION EXPERIENCE
              </div>
            </div>
          </div>

          <div className="relative max-w-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-200/20 bg-sky-300/10 px-3 py-2 text-xs text-sky-100">
              <ShieldCheck size={14} /> Secure auction workspace
            </div>
            <h1 className="glow-text text-6xl font-black leading-[1.02]">
              TIME IS
              <br />
              YOUR <span className="text-sky-200">CURRENCY.</span>
            </h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-slate-300/75">
              Bid it. Spin it. Bingo it. Step into the arena where every
              second counts.
            </p>
            <div className="mt-8 flex items-center gap-3 text-xs font-bold tracking-[.2em] text-amber-200">
              <Sparkles size={15} /> THE AUCTION STARTS HERE
            </div>
          </div>

          <p className="relative text-[10px] tracking-[.22em] text-slate-500">
            DAEMON HOUR · BUILT FOR THE MOMENT
          </p>
        </section>

        <section className="flex items-center justify-center px-6 py-14 sm:px-12">
          <div className="w-full max-w-sm">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <div className="rounded-xl border border-sky-200/20 bg-sky-300/10 p-2 text-sky-200">
                <Hourglass />
              </div>
              <span className="font-black tracking-[.18em]">
                DAEMON HOUR
              </span>
            </div>

            <p className="text-xs font-bold uppercase tracking-[.24em] text-sky-300">
              Your next move begins now
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">
              Enter the arena.
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Sign in with your Admin email or team username.
            </p>

            {search.get("error") === "profile" && (
              <p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                Your login exists, but no matching profile was found. Ask
                an administrator to check your profile.
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-xl border border-red-300/20 bg-red-300/10 p-3 text-sm text-red-200"
              >
                {error}
              </p>
            )}

            <form onSubmit={signIn} className="mt-8 space-y-5">
              <label className="block text-sm font-medium text-slate-300">
                Admin email or team username
                <input
                  className="field mt-2"
                  type="text"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Email or TEAM_ALPHA"
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                Password
                <input
                  className="field mt-2"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                />
              </label>

              <button
                className="btn-primary w-full"
                disabled={busy}
                type="submit"
              >
                {busy ? "Entering…" : "Enter DAEMON HOUR"}
              </button>
            </form>

            <div className="mt-8 flex items-center justify-center gap-2 text-center text-[10px] leading-5 text-slate-500">
              <ShieldCheck size={13} />
              Protected by Supabase authentication and database permissions.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
