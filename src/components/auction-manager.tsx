"use client";

import { useState } from "react";
import { Gavel, Plus, Loader2, PackageCheck, Pencil, Power, Trash2 } from "lucide-react";

type Item = { id: string; item_name: string; description: string | null; base_points: number; is_active: boolean; created_at?: string };

export default function AuctionManager({ initialItems, isAdmin, initialBalance }: { initialItems: Item[]; isAdmin: boolean; initialBalance: number }) {
  const [items, setItems] = useState(initialItems);
  const [balance, setBalance] = useState(initialBalance);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("100");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function saveItem(event: React.FormEvent) {
    event.preventDefault(); setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auction-items", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(editing ? { id: editing } : {}), item_name: name, description, base_points: Number(price) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.details ? `${result.error} (${result.details})` : result.error || "Could not save item.");
      setItems((old) => editing ? old.map((item) => item.id === editing ? result.item : item) : [result.item, ...old]);
      setName(""); setDescription(""); setPrice("100"); setEditing(null); setNotice("Auction item saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(null); }
  }

  function startEdit(item: Item) { setEditing(item.id); setName(item.item_name); setDescription(item.description ?? ""); setPrice(String(item.base_points)); setError(""); setNotice(""); }

  async function toggleActive(item: Item) {
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auction-items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, is_active: !item.is_active }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.details ? `${result.error} (${result.details})` : result.error || "Could not update item.");
      setItems((old) => old.map((entry) => entry.id === item.id ? result.item : entry));
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(null); }
  }

  async function deleteItem(item: Item) {
    if (!window.confirm(`Delete "${item.item_name}"? If it has purchase history, it will be archived instead so existing records remain intact.`)) return;
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auction-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.details ? `${result.error} (${result.details})` : result.error || "Could not delete item.");
      if (result.deleted) {
        setItems((old) => old.filter((entry) => entry.id !== item.id));
        setNotice("Auction item permanently deleted.");
      } else {
        setItems((old) => old.map((entry) => entry.id === item.id ? result.item : entry));
        setNotice(result.message || "Auction item archived to preserve purchase history.");
      }
      if (editing === item.id) {
        setEditing(null); setName(""); setDescription(""); setPrice("100");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete item."); }
    finally { setBusy(null); }
  }

  async function purchase(item: Item) {
    if (!window.confirm(`Purchase ${item.item_name} for ${item.base_points.toLocaleString("en-IN")} points?`)) return;
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: item.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Purchase failed.");
      setBalance((old) => old - item.base_points); setNotice(`${item.item_name} purchased successfully. Your points have been updated.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(null); }
  }

  return <div className="space-y-7">
    <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-sky-300">DAEMON HOUR / COMMAND DECK</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Auction items</h1><p className="mt-2 text-sm text-slate-500">{isAdmin ? "Create, price and control the items available in your auction." : "Explore available items and use your team's points to purchase them."}</p></div>
    {!isAdmin && <section className="panel flex items-center justify-between gap-4 p-5"><div><p className="text-xs uppercase tracking-wider text-slate-400">Available points</p><p className="mt-1 text-3xl font-semibold text-white">{balance.toLocaleString("en-IN")}</p></div><div className="rounded-xl border border-sky-200/15 bg-sky-300/10 p-3 text-sky-200"><PackageCheck size={22}/></div></section>}
    {isAdmin && <section className="panel p-6"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl border border-sky-300/20 bg-sky-300/10 p-3 text-sky-200"><Plus size={20}/></div><div><h2 className="font-semibold text-white">{editing ? "Edit auction item" : "Add auction item"}</h2><p className="mt-1 text-xs text-slate-500">Set the item name, details and fixed purchase price.</p></div></div><form onSubmit={saveItem} className="grid gap-3 sm:grid-cols-2"><input value={name} onChange={(e)=>setName(e.target.value)} required maxLength={120} placeholder="Item name" className="rounded-xl border border-white/10 bg-[#090f1b] px-4 py-3 text-sm text-white outline-none focus:border-sky-300/50"/><input value={price} onChange={(e)=>setPrice(e.target.value)} required type="number" min="1" step="1" placeholder="Points price" className="rounded-xl border border-white/10 bg-[#090f1b] px-4 py-3 text-sm text-white outline-none focus:border-sky-300/50"/><textarea value={description} onChange={(e)=>setDescription(e.target.value)} rows={2} placeholder="Description (optional)" className="sm:col-span-2 rounded-xl border border-white/10 bg-[#090f1b] px-4 py-3 text-sm text-white outline-none focus:border-sky-300/50"/><div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={busy!==null} className="flex items-center gap-2 rounded-xl border border-sky-200/30 bg-sky-400/15 px-5 py-3 text-sm font-semibold text-sky-100 disabled:opacity-50">{busy==="save"?<Loader2 size={16} className="animate-spin"/>:<Plus size={16}/>}{editing?"Save changes":"Add item"}</button>{editing && <button type="button" onClick={()=>{setEditing(null);setName("");setDescription("");setPrice("100");}} className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300">Cancel edit</button>}</div></form></section>}
    {error && <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{error}</p>}{notice && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
    <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex items-center gap-3"><Gavel size={18} className="text-sky-200"/><h2 className="font-semibold">{isAdmin?"Auction inventory":"Available items"}</h2></div><span className="text-xs text-slate-400">{items.length} items</span></div>
      {items.length===0?<div className="px-6 py-12 text-center text-sm text-slate-500">{isAdmin?"No auction items yet. Add your first item above.":"No items are available right now."}</div>:<div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">{items.map((item)=><article key={item.id} className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold text-white">{item.item_name}</h3><p className="mt-2 min-h-10 text-sm leading-5 text-slate-400">{item.description||"No description provided."}</p></div>{isAdmin && <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wider ${item.is_active?"bg-emerald-400/10 text-emerald-200":"bg-slate-400/10 text-slate-400"}`}>{item.is_active?"Active":"Hidden"}</span>}</div><div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">Fixed price</p><p className="mt-1 text-2xl font-semibold text-sky-200">{item.base_points.toLocaleString("en-IN")} <span className="text-xs font-normal text-slate-400">pts</span></p></div>{isAdmin?<div className="flex gap-2"><button title="Edit item" onClick={()=>startEdit(item)} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:text-sky-200"><Pencil size={16}/></button><button title={item.is_active?"Hide item":"Activate item"} disabled={busy===item.id} onClick={()=>toggleActive(item)} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:text-sky-200">{busy===item.id?<Loader2 size={16} className="animate-spin"/>:<Power size={16}/>}</button><button title="Archive item from auction inventory" disabled={busy===item.id} onClick={()=>deleteItem(item)} className="rounded-lg border border-red-300/15 p-2 text-red-300 hover:bg-red-300/10 disabled:opacity-50"><Trash2 size={16}/></button></div>:<button disabled={busy===item.id||!item.is_active||balance<item.base_points} onClick={()=>purchase(item)} className="rounded-xl border border-sky-200/30 bg-sky-400/15 px-4 py-2.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-40">{busy===item.id?<Loader2 size={15} className="animate-spin"/>:balance<item.base_points?"Insufficient points":"Purchase"}</button>}</div></article>)}</div>}</section>
  </div>;
}
