type Props = { rows: Record<string, unknown>[]; empty: string };

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DataTable({ rows, empty }: Props) {
  if (!rows.length) return <div className="px-6 py-12 text-center text-sm text-faint">{empty}</div>;
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).slice(0, 8);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead><tr className="border-b border-silver bg-frost">{columns.map(c=><th key={c} className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-cobalt-ink">{c.replaceAll("_"," ")}</th>)}</tr></thead>
        <tbody>{rows.map((row,i)=><tr key={String(row.id ?? i)} className="border-b border-silver last:border-0 hover:bg-frost">{columns.map(c=><td key={c} className="max-w-[260px] truncate px-5 py-4 text-muted">{display(row[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
