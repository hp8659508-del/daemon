import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await context.params;
  const { data, error } = await supabase.rpc("spin_for_team", { p_event_id: id });
  if (error) return NextResponse.json({ error: error.message.includes("already spun") ? "Your team has already spun for this event." : error.message }, { status: 400 });
  return NextResponse.json({ result: data });
}
