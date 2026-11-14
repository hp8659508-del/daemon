
"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";
import { Hourglass } from "@/components/ui";

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
  const [show, setShow] = useState(false);

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
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-4 sm:p-8">
      <div className="paper-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="panel relative grid w-full max-w-5xl overflow-hidden lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-silver/70 bg-gradient-to-b from-frost to-porcelain p-10 lg:flex">
          <div className="flex items-center gap-3">
            <img src="/md-logo.svg" alt="" className="h-10 w-7" />
            <div className="leading-none"><div className="font-display font-black tracking-[.16em]">DAEMON HOUR</div><div className="mt-1 text-[9px] font-semibold tracking-[.24em] text-muted">THE MOBILE APP DEVELOPMENT CLUB</div></div>
          </div>
          <div className="relative">
            <div className="absolute -right-6 -top-10 opacity-90"><Hourglass fill={0.62} size={150} /></div>
            <p className="eyebrow">17 &amp; 18 November · Falconry Seminar Hall &amp; Idea Lab</p>
            <h1 className="font-serif mt-4 text-6xl leading-[.95]">Time is your<br /><span className="prism-text italic">currency.</span></h1>
            <p className="mt-5 max-w-xs text-sm leading-6 text-muted">A hackathon like never before. Bid it, spin it, bingo it, and watch your deadline move with every power-up you earn.</p>
          </div>
          <div className="flex gap-2">{["Bid it", "Spin it", "Bingo it"].map(t => <span key={t} className="chip">{t}</span>)}</div>
        </section>

        <section className="flex items-center justify-center px-6 py-14 sm:px-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden"><img src="/md-logo.svg" alt="" className="h-9 w-6" /><span className="font-display font-black tracking-[.16em]">DAEMON HOUR</span></div>
            <p className="eyebrow">Team leads only</p>
            <h2 className="font-display mt-2 text-3xl font-black">Enter the arena</h2>
            <p className="mt-2 text-sm text-muted">Sign in with your team username, e.g. <span className="num text-graphite">STRAW_HATS</span>.</p>

            {search.get("error") === "profile" && <p className="well mt-5 p-3 text-sm text-err">Your login exists but isn&apos;t linked to a team. Ask an organiser.</p>}
            {error && <p role="alert" className="well mt-5 p-3 text-sm text-err">{error}</p>}

            <form onSubmit={signIn} className="mt-7 space-y-4">
              <label className="block text-xs font-semibold text-muted">Team username
                <input className="field num mt-1.5 uppercase" type="text" autoComplete="username" autoCapitalize="characters" spellCheck={false} required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="TEAM_NAME" />
              </label>
              <label className="block text-xs font-semibold text-muted">Password
                <div className="relative mt-1.5">
                  <input className="field pr-16" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-cobalt-ink">{show ? "Hide" : "Show"}</button>
                </div>
              </label>
              <button className="key-primary key-lg w-full" disabled={busy} type="submit">{busy ? "Checking the clock…" : "Enter Daemon Hour"}</button>
            </form>
            <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-faint"><ShieldCheck size={13} /> Organisers sign in with their email</p>
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
