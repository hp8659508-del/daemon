import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { LogOut, Users, Gauge, KeyRound } from "lucide-react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  async function signOut() {
    "use server";
    const client = await createClient();
    await client.auth.signOut();
    redirect("/login");
  }
  const admin = profile.role === "admin";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-silver/60 bg-porcelain/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <img src="/md-logo.svg" alt="" className="h-9 w-6" />
            <div className="leading-none">
              <div className="font-display text-[15px] font-black tracking-[.14em]">DAEMON HOUR</div>
              <div className="mt-1 text-[9px] font-semibold tracking-[.24em] text-muted">BID IT · SPIN IT · BINGO IT</div>
            </div>
          </Link>
          <div className="mx-2 hidden h-6 w-px bg-silver sm:block" />
          <span className="hidden text-xs text-muted sm:block">MD Club · NHCE · 17–18 Nov</span>
          <nav className="ml-auto flex items-center gap-2">
            {admin && <>
              <Link href="/dashboard/control" className="key key-sm"><Gauge size={14} /> Control</Link>
              <Link href="/dashboard/teams" className="key key-sm"><Users size={14} /> Teams</Link>
            </>}
            <Link href="/account/change-password" className="key key-sm" title="Change password"><KeyRound size={14} /></Link>
            <form action={signOut}><button className="key key-sm" title="Sign out"><LogOut size={14} /><span className="hidden sm:inline">Sign out</span></button></form>
          </nav>
        </div>
        <div className="h-[2px] w-full opacity-70" style={{ background: "var(--prism)" }} />
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
