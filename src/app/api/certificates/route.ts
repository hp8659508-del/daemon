import { getUserCached } from "@/lib/supabase/cached-user";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/certificates?id=…[&view=1] → a 60-second signed link to the file.
 * Teams: only their own certificates, and only after an organiser publishes certificates.
 * Organisers: any certificate, any time. The bucket itself is private, so there is no other way in.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const view = new URL(request.url).searchParams.has("view");
  const supabase = await createClient();
  const user = await getUserCached(supabase as never);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const db = createAdminClient();
  const [{ data: p }, { data: c }, { data: st }] = await Promise.all([
    db.from("profiles").select("role, team_id").eq("id", user.id).maybeSingle(),
    db.from("certificates").select("team_id, file_path, file_name").eq("id", id).maybeSingle(),
    db.from("event_settings").select("certs_published").eq("id", true).maybeSingle(),
  ]);
  const admin = p?.role === "admin";
  if (!c || (!admin && c.team_id !== p?.team_id)) return NextResponse.json({ error: "Certificate not found." }, { status: 404 });
  if (!admin && !st?.certs_published) return NextResponse.json({ error: "Certificates are not released yet." }, { status: 403 });
  const { data, error } = await db.storage.from("certificates").createSignedUrl(c.file_path, 60, view ? undefined : { download: c.file_name });
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message ?? "Could not open the file." }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
