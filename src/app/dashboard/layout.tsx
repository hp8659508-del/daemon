import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { LogOut, Gauge, KeyRound } from "lucide-react";
import { LogoGlass } from "@/components/ui";

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
      <header className="sticky top-0 z-30 border-b border-graphite bg-white">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <LogoGlass size={46} logo />
            <div className="dh-brand-text leading-none">
              <div className="font-display text-[17px] tracking-[.06em]">DAEMON HOUR</div>
              <div className="mt-1 text-[9px] font-semibold tracking-[.24em] text-muted">BID IT · SPIN IT · BINGO IT</div>
            </div>
          </Link>
          <div className="mx-2 hidden h-6 w-px bg-silver sm:block" />
          <span className="hidden text-xs font-bold uppercase tracking-[.2em] sm:block">MAD Club · NHCE</span>
          <nav className="ml-auto flex items-center gap-2">
            {admin && <>
              <Link href="/dashboard/control" className="key key-sm"><Gauge size={14} /> Control</Link>
            </>}
            <Link href="/account/change-password" className="key key-sm" title="Change password"><KeyRound size={14} /></Link>
            <form action="/api/auth/signout" method="POST"><button type="submit" className="key key-sm" title="Sign out"><LogOut size={14} /><span className="hidden sm:inline">Sign out</span></button></form>
          </nav>
        </div>
        <div className="h-[3px] w-full" style={{ background: "var(--prism)" }} />
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
