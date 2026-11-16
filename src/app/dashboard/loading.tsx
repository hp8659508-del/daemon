import { Hourglass } from "@/components/ui";

export default function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Hourglass mode="loader" size={64} tone="ink" />
        <p className="eyebrow">Turning the hourglass…</p>
      </div>
    </div>
  );
}
