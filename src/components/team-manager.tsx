
"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, Plus, Copy, Check, Loader2, Pencil, Save, X, ExternalLink, Activity, KeyRound, Wallet, Send } from "lucide-react";

type Team = {
  id: string;
  team_name: string;
  username: string | null;
  created_at: string;
};

type CreatedTeam = {
  name: string;
  username: string;
  initial_password: string;
  starting_points: number | null;
};

export default function TeamManager({
  initialTeams,
  initialStartingPoints,
  startingPointsPublished,
}: {
  initialTeams: Team[];
  initialStartingPoints: number;
  startingPointsPublished: boolean;
}) {
  const [teams, setTeams] = useState(initialTeams);
  const [teamName, setTeamName] = useState("");
  const [createdTeam, setCreatedTeam] = useState<CreatedTeam | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [startingPoints, setStartingPoints] = useState(startingPointsPublished ? String(initialStartingPoints) : "");
  const [publishedAmount, setPublishedAmount] = useState(initialStartingPoints);
  const [published, setPublished] = useState(startingPointsPublished);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishMessage, setPublishMessage] = useState("");

  async function createTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setCreatedTeam(null);

    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_name: teamName }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not create team.");
      }

      setCreatedTeam(result.team);
      setTeams((previous) => [
        {
          id: result.team.id,
          team_name: result.team.name,
          username: result.team.username,
          created_at: new Date().toISOString(),
        },
        ...previous,
      ]);
      setTeamName("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveTeamName(id: string) {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/teams", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, team_name: editingName }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update team.");
      setTeams((old) => old.map((team) => team.id === id ? result.team : team));
      setEditingId(null); setEditingName("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update team."); }
    finally { setLoading(false); }
  }

  async function publishStartingPoints(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPublishLoading(true);
    setPublishMessage("");
    setError("");
    try {
      const amount = Number(startingPoints);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) {
        throw new Error("Enter a whole-number amount from 0 to 1,000,000,000.");
      }
      if (!window.confirm(`Publish ${amount.toLocaleString("en-IN")} starting points to all ${teams.length} teams? This action cannot be repeated.`)) return;
      const response = await fetch("/api/event-settings/starting-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starting_points: amount }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not publish starting points.");
      setPublished(true);
      setPublishedAmount(amount);
      setPublishMessage(`Published ${amount.toLocaleString("en-IN")} points to ${result.teams_updated} teams.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish starting points.");
    } finally {
      setPublishLoading(false);
    }
  }

  async function copyCredentials() {
    if (!createdTeam) return;

    const credentials = [
      `DAEMON HOUR - TEAM LOGIN`,
      `Team: ${createdTeam.name}`,
      `Username: ${createdTeam.username}`,
      `Initial password: ${createdTeam.initial_password}`,
      ...(createdTeam.starting_points === null ? [] : [`Starting points: ${createdTeam.starting_points}`]),
      `Please change your password after your first login.`,
    ].join("\n");

    await navigator.clipboard.writeText(credentials);
    setCopied(true);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-cobalt-ink">
          DAEMON HOUR / COMMAND DECK
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Team management
        </h1>
        <p className="mt-2 text-sm text-faint">
          Create team accounts and manage your event participants.
        </p>
      </div>

      <section className="panel p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl border border-frost bg-frost p-3 text-brass"><Wallet size={20} /></div>
          <div>
            <h2 className="font-semibold text-graphite">Event starting points</h2>
            <p className="mt-1 text-xs text-faint">Choose the same opening balance for every team and publish it when the event is ready.</p>
          </div>
        </div>
        {published ? (
          <div className="rounded-xl border border-frost bg-frost p-4">
            <p className="text-sm font-semibold text-ok">Starting points published</p>
            <p className="mt-1 text-sm text-muted">{publishedAmount.toLocaleString("en-IN")} points were published to all teams. New teams will receive the same opening balance.</p>
          </div>
        ) : (
          <form onSubmit={publishStartingPoints} className="flex flex-col gap-3 sm:flex-row">
            <input type="number" min="0" max="1000000000" step="1" required value={startingPoints} onChange={(event) => setStartingPoints(event.target.value)} placeholder="Enter starting points" className="min-w-0 flex-1 rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite outline-none focus:border-frost" />
            <button type="submit" disabled={publishLoading || !startingPoints.trim() || teams.length === 0} className="flex items-center justify-center gap-2 rounded-xl border border-frost bg-frost px-5 py-3 text-sm font-semibold text-brass transition hover:bg-frost disabled:opacity-50">
              {publishLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {publishLoading ? "Publishing..." : `Publish to ${teams.length} teams`}
            </button>
          </form>
        )}
        {publishMessage && <p className="mt-3 text-sm text-ok">{publishMessage}</p>}
        {!published && <p className="mt-3 text-xs text-brass/70">Not published yet. Teams will not receive any opening points until you confirm publication.</p>}
      </section>

      <section className="panel p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl border border-frost bg-frost p-3 text-cobalt-ink">
            <Plus size={20} />
          </div>
          <div>
            <h2 className="font-semibold text-graphite">Create a new team</h2>
            <p className="mt-1 text-xs text-faint">
              A username and initial password will be generated automatically.
            </p>
          </div>
        </div>

        <form onSubmit={createTeam} className="flex flex-col gap-3 sm:flex-row">
          <input
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            placeholder="Enter team name (e.g. TEAM ALPHA)"
            maxLength={80}
            required
            className="min-w-0 flex-1 rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite outline-none transition placeholder:text-faint focus:border-frost"
          />
          <button
            type="submit"
            disabled={loading || !teamName.trim()}
            className="flex items-center justify-center gap-2 rounded-xl border border-frost bg-frost px-5 py-3 text-sm font-semibold text-cobalt-ink transition hover:bg-frost disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            {loading ? "Creating..." : "Create team"}
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-xl border border-frost bg-frost p-3 text-sm text-err">
            {error}
          </p>
        )}

        {createdTeam && (
          <div className="mt-6 rounded-2xl border border-frost bg-frost p-5">
            <div className="mb-4 flex items-center gap-2 text-cobalt-ink">
              <Check size={18} />
              <h3 className="font-semibold">Team created successfully</h3>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-faint">Team name</p>
                <p className="mt-1 font-medium text-graphite">
                  {createdTeam.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-faint">Username</p>
                <p className="mt-1 font-mono text-cobalt-ink">
                  {createdTeam.username}
                </p>
              </div>
              <div>
                <p className="text-xs text-faint">Initial password</p>
                <p className="mt-1 font-mono text-brass">
                  {createdTeam.initial_password}
                </p>
              </div>
              {createdTeam.starting_points !== null && <div>
                <p className="text-xs text-faint">Starting points</p>
                <p className="mt-1 font-semibold text-graphite">{createdTeam.starting_points.toLocaleString("en-IN")}</p>
              </div>}
            </div>

            <button
              type="button"
              onClick={copyCredentials}
              className="mt-5 flex items-center gap-2 rounded-xl border border-silver bg-frost px-4 py-2.5 text-sm text-graphite transition hover:bg-frost"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Credentials copied" : "Copy login credentials"}
            </button>

            <p className="mt-3 text-xs leading-5 text-brass/80">
              Share these credentials securely. The team must change its
              password after its first login.
            </p>
          </div>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-silver px-5 py-4">
          <div className="flex items-center gap-3">
            <Users size={18} className="text-cobalt-ink" />
            <h2 className="font-semibold">Registered teams</h2>
          </div>
          <span className="text-xs text-muted">
            {teams.length} teams
          </span>
        </div>

        {teams.length === 0 ? (
          <div className="p-10 text-center">
            <Users size={28} className="mx-auto text-faint" />
            <p className="mt-3 text-sm text-muted">
              No teams have been created yet.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[.06]">
            {teams.map((team) => (
              <div
                key={team.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  {editingId === team.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input value={editingName} onChange={(event) => setEditingName(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-silver bg-white px-3 py-2 text-sm text-graphite" />
                      <button disabled={loading} onClick={() => saveTeamName(team.id)} className="rounded-lg border border-frost p-2 text-cobalt-ink"><Save size={15}/></button>
                      <button onClick={() => setEditingId(null)} className="rounded-lg border border-silver p-2 text-muted"><X size={15}/></button>
                    </div>
                  ) : (
                    <Link href={`/dashboard/teams/${team.id}`} className="inline-flex max-w-full items-center gap-2 truncate text-sm font-semibold text-graphite transition hover:text-cobalt-ink"><span className="truncate">{team.team_name}</span><ExternalLink size={13} className="shrink-0 text-cobalt-ink" /></Link>
                  )}
                  <p className="mt-1 text-xs text-faint">
                    Username:{" "}
                    <span className="font-mono text-cobalt-ink">
                      {team.username || "Not assigned"}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-faint">
                  <Link href={`/dashboard/teams/${team.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-frost bg-frost px-3 py-2 text-xs font-medium text-cobalt-ink transition hover:bg-frost" aria-label={`View all activity for ${team.team_name}`}>
                    <Activity size={14} /> View activity
                  </Link>
                  <button title="Edit team name" onClick={() => { setEditingId(team.id); setEditingName(team.team_name); }} className="rounded-lg border border-silver p-2 text-muted hover:text-cobalt-ink"><Pencil size={14}/></button>
                  <KeyRound size={14} />
                  Team account
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
