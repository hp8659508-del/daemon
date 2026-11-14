import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <h2 className="text-2xl font-bold">404 - Page Not Found</h2>
      <p className="mt-2 text-sm text-slate-500">The requested page could not be found.</p>
      <Link href="/dashboard" className="mt-4 rounded border border-black bg-black px-4 py-2 text-sm text-white">
        Back to Dashboard
      </Link>
    </div>
  );
}
