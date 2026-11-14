import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SpinManager } from "@/components/spin-manager";
export default async function SpinsPage(){await requireAdmin();const supabase=await createClient();const db=createAdminClient();const [{data:events},{data:teams}] = await Promise.all([supabase.from("spin_events").select("id,event_name,status,created_at").order("created_at",{ascending:false}),db.from("teams").select("id,team_name").order("team_name")]);return <SpinManager initialEvents={events??[]} teams={teams??[]}/>;}
