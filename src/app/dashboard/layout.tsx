import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { Gavel, LayoutDashboard, Users, ShoppingCart, Receipt, LogOut, ShieldCheck, Hourglass, Sparkles } from "lucide-react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  async function signOut() {
    "use server";
    const client = await createClient();
    await client.auth.signOut();
    redirect("/login");
  }
  const nav = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/dashboard/auctions", label: "Auction items", icon: Gavel },
    { href: "/dashboard/purchases", label: "Purchases", icon: ShoppingCart },
    { href: "/dashboard/transactions", label: "Transactions", icon: Receipt },
    ...(profile.role === "admin" ? [{ href: "/dashboard/teams", label: "Teams", icon: Users }, { href: "/dashboard/spins", label: "Spin events", icon: Sparkles }] : [])
  ];
  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 md:flex hourglass-grid">
      <aside className="relative z-10 flex w-full flex-col border-b border-white/10 bg-[#080d17]/95 backdrop-blur-xl md:fixed md:inset-y-0 md:w-64 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 border-b border-white/10 px-6 py-6">
          <div className="rounded-2xl border border-sky-200/30 bg-sky-400/10 p-3 text-sky-200 shadow-[0_0_24px_rgba(83,165,255,.2)]"><Hourglass size={23}/></div>
          <div><div className="text-sm font-black tracking-[.19em] text-white">DAEMON HOUR</div><div className="mt-1 text-[9px] tracking-[.23em] text-sky-200/60">BID IT · SPIN IT · BINGO IT</div></div>
        </div>
        <div className="px-4 py-6">
          <p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[.24em] text-slate-500">Command deck</p>
          <nav className="space-y-1">
            {nav.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-sm text-slate-400 transition hover:border-sky-300/15 hover:bg-sky-300/[.07] hover:text-white"><Icon size={17} className="text-sky-200/70 group-hover:text-sky-200"/>{item.label}<span className="ml-auto h-1.5 w-1.5 rounded-full bg-transparent group-hover:bg-sky-300"/></Link>; })}
          </nav>
        </div>
        <div className="mt-auto border-t border-white/10 p-5">
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.04] p-3">
            <div className="rounded-full bg-sky-300/10 p-2 text-sky-200"><ShieldCheck size={16}/></div>
            <div className="min-w-0"><p className="truncate text-xs font-medium text-white">{user?.email}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-amber-200">{profile.role} access</p></div>
          </div>
          <form action={signOut}><button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-500 transition hover:bg-white/5 hover:text-white"><LogOut size={16}/> Sign out</button></form>
          <div className="mt-5 flex items-center gap-2 px-3 text-[9px] uppercase tracking-[.2em] text-slate-600"><Sparkles size={12}/> Time is your currency</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 md:ml-64 md:p-9">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
