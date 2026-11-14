import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role, team_id").eq("id", user.id).maybeSingle();
    if (profile?.role !== "team" || !profile.team_id) return NextResponse.json({ error: "Only team accounts can purchase auction items." }, { status: 403 });
    const body = await request.json();
    if (typeof body.item_id !== "string") return NextResponse.json({ error: "Choose an auction item." }, { status: 400 });
    const { data, error } = await supabase.rpc("purchase_auction_item", { p_item_id: body.item_id });
    if (error) {
      const message = error.message.toLowerCase().includes("insufficient")
        ? "Your team does not have enough points for this item."
        : error.message.toLowerCase().includes("unavailable")
          ? "This item is no longer available."
          : "The purchase could not be completed. Please refresh and try again.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ success: true, purchase: data });
  } catch (error) {
    console.error("Purchase failed:", error);
    return NextResponse.json({ error: "Purchase failed. Please try again." }, { status: 500 });
  }
}
