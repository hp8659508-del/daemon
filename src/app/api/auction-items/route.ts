import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

async function getAdminClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Please sign in." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only administrators can manage auction items." }, { status: 403 }) };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: NextResponse.json({ error: "Server configuration is missing." }, { status: 500 }) };
  return { client: createSupabaseAdmin(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) };
}

export async function POST(request: Request) {
  try {
    const auth = await getAdminClient();
    if (auth.error) return auth.error;
    const body = await request.json();
    const item_name = typeof body.item_name === "string" ? body.item_name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const base_points = Number(body.base_points);
    if (!item_name || item_name.length > 120 || !Number.isSafeInteger(base_points) || base_points < 1) {
      return NextResponse.json({ error: "Enter an item name and a whole-number price greater than zero." }, { status: 400 });
    }
    const { data, error } = await auth.client!.from("auction_items").insert({ item_name, description, base_points, is_active: true }).select("id, item_name, description, base_points, is_active, created_at").single();
    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (error) {
    console.error("Auction item creation failed:", error);
    return NextResponse.json({ error: "Could not create the auction item.", details: error instanceof Error ? error.message : "Unknown database error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getAdminClient();
    if (auth.error) return auth.error;
    const body = await request.json();
    if (typeof body.id !== "string") return NextResponse.json({ error: "Item ID is required." }, { status: 400 });
    const updates: Record<string, unknown> = {};
    if (typeof body.item_name === "string") updates.item_name = body.item_name.trim();
    if (typeof body.description === "string") updates.description = body.description.trim();
    if (body.base_points !== undefined) {
      const price = Number(body.base_points);
      if (!Number.isSafeInteger(price) || price < 1) return NextResponse.json({ error: "Price must be a whole number greater than zero." }, { status: 400 });
      updates.base_points = price;
    }
    if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
    if (typeof updates.item_name === "string" && (!updates.item_name || updates.item_name.length > 120)) return NextResponse.json({ error: "Item name is required and must be 120 characters or fewer." }, { status: 400 });
    const { data, error } = await auth.client!.from("auction_items").update(updates).eq("id", body.id).select("id, item_name, description, base_points, is_active, created_at").single();
    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (error) {
    console.error("Auction item update failed:", error);
    return NextResponse.json({ error: "Could not update the auction item.", details: error instanceof Error ? error.message : "Unknown database error" }, { status: 500 });
  }
}


/**
 * "Delete" an auction item by archiving it (is_active=false).
 * This preserves purchase history and avoids breaking existing foreign keys.
 */
export async function DELETE(request: Request) {
  try {
    const auth = await getAdminClient();
    if (auth.error) return auth.error;
    const body = await request.json();
    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "Item ID is required." }, { status: 400 });
    }
    const itemId = body.id.trim();

    // Preserve referential integrity: purchases.item_id uses ON DELETE NO ACTION.
    const { count, error: purchaseCheckError } = await auth.client!
      .from("purchases")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId);
    if (purchaseCheckError) throw purchaseCheckError;

    if ((count ?? 0) > 0) {
      const { data, error } = await auth.client!
        .from("auction_items")
        .update({ is_active: false })
        .eq("id", itemId)
        .select("id, item_name, description, base_points, is_active, created_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Auction item was not found." }, { status: 404 });
      return NextResponse.json({ item: data, archived: true, message: "This item has purchase history, so it was archived instead of permanently deleted." });
    }

    const { data, error } = await auth.client!
      .from("auction_items")
      .delete()
      .eq("id", itemId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Auction item was not found." }, { status: 404 });
    return NextResponse.json({ deleted: true, id: itemId });
  } catch (error) {
    console.error("Auction item archive failed:", error);
    return NextResponse.json({ error: "Could not delete the auction item.", details: error instanceof Error ? error.message : "Unknown database error" }, { status: 500 });
  }
}
