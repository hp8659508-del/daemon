
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";
import { LogoGlass } from "@/components/ui";
import SandClock from "@/components/sand-clock";

// Opening bell, shown on the T-MINUS readout until it passes.
const EVENT_START = new Date("2026-11-17T09:00:00+05:30");

function useTMinus() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (now === null) return "--:--:--";
  const s = Math.floor((EVENT_START.getTime() - now) / 1000);
  if (s <= 0) return "LIVE";
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => { setOn(navigator.onLine); const u = () => setOn(true), d = () => setOn(false); addEventListener("online", u); addEventListener("offline", d); return () => { removeEventListener("online", u); removeEventListener("offline", d); }; }, []);
  return on;
}

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
  const [retrying, setRetrying] = useState(0);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const supabase = createClient();

      // Busy moments (hundreds signing in from one campus network) can hit Supabase's
      // rate limit: retry a few times with growing waits instead of calling it a wrong password.
      let error: { status?: number; message?: string } | null = null;
      const WAITS = [2000, 4000, 8000, 12000, 16000, 20000];   // ~1 minute of patient retrying
      for (let attempt = 0; ; attempt++) {
        ({ error } = await supabase.auth.signInWithPassword({ email: getLoginEmail(identifier), password }));
        const busy = !!error && (error.status === 429 || (error.status ?? 0) >= 500 || /rate|too many|timeout|fetch/i.test(error.message ?? ""));
        if (!busy || attempt >= WAITS.length) break;
        setRetrying(attempt + 1);
        await new Promise(r => setTimeout(r, WAITS[attempt] + Math.random() * 1500));
      }
      setRetrying(0);

      if (error) {
        if (error.status === 429 || /rate|too many/i.test(error.message ?? "")) throw new Error("Still very busy. Wait a minute and press ENGAGE again.");
        if ((error.status ?? 0) >= 500 || /fetch|timeout/i.test(error.message ?? "")) throw new Error("Can't reach the server right now. Check your internet and try again.");
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

  const tminus = useTMinus();
  const online = useOnline();
  const screws = ["left-3 top-3", "right-3 top-3", "left-3 bottom-3", "right-3 bottom-3"];

  return (
    <main className="dh-desk grid min-h-screen place-items-center p-4 sm:p-8">
      <div className="dh-device w-full max-w-[980px]">
        <div className="dh-face grid lg:grid-cols-[300px_1fr]">
          {screws.map(c => <span key={c} className={`dh-screw ${c}`} />)}

          <div className="dh-window m-5 lg:m-7">
            <SandClock mode="loader" drainMs={13000} size={150} tone="glass" title="Daemon Hour sand clock" />
            <small>DH · MODEL 17/18</small>
          </div>

          <div className="relative px-6 pb-8 sm:px-10 lg:py-8 lg:pl-2 lg:pr-10">
            <div className="flex items-center gap-3">
              <LogoGlass size={40} logo />
              <div className="leading-none">
                <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#55516a]">MAD Club · NHCE</div>
                <h1 className="font-display mt-1 text-[32px] font-extrabold tracking-[-.02em] text-[#22202c]">DAEMON HOUR</h1>
              </div>
            </div>

            <div className="dh-readout mt-5">
              <span>{tminus === "LIVE" ? "STATUS" : "T-MINUS"}</span>
              <b>{tminus}</b>
            </div>

            {search.get("expired") && <p className="dh-alert mt-4">You were signed out. Please sign in again.</p>}
            {search.get("error") === "profile" && <p className="dh-alert mt-4">Your login exists but isn&apos;t linked to a team. Ask an organiser.</p>}
            {error && <p role="alert" className="dh-alert mt-4">{error}</p>}

            <form onSubmit={signIn} className="mt-2">
              <label className="dh-lbl" htmlFor="dh-id">Team ID</label>
              <input id="dh-id" className="dh-input uppercase" type="text" autoComplete="username" autoCapitalize="characters" spellCheck={false} required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="STRAW_HATS" />
              <label className="dh-lbl" htmlFor="dh-pw">Access code</label>
              <div className="relative">
                <input id="dh-pw" className="dh-input pr-16" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold tracking-[.12em] text-[#5136E0]">{show ? "HIDE" : "SHOW"}</button>
              </div>
              <button className="dh-key mt-6" disabled={busy} type="submit">{busy ? (retrying ? `BUSY · RETRYING ${retrying}/6…` : "CHECKING THE CLOCK…") : "ENGAGE"}</button>
              {retrying > 0 && <p className="mt-2 text-center text-xs text-[#55516a]">Lots of people are signing in. Hold on, we keep trying for you.</p>}
            </form>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="dh-leds">
                <span className={online ? "" : "off"}><i />{online ? "ONLINE" : "OFFLINE"}</span>
                <span className={busy ? "" : "off"}><i />AUTH</span>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-[#55516a]"><ShieldCheck size={13} /> Organisers sign in with their email</p>
            </div>
          </div>
        </div>
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
