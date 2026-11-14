
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (password.length < 10) {
      setMessage("Use at least 10 characters.");
      return;
    }

    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not update password.");
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-5 text-graphite">
      <form
        onSubmit={update}
        className="panel w-full max-w-md p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-cobalt-ink">
          DAEMON HOUR / ACCOUNT SECURITY
        </p>

        <h1 className="mt-3 text-2xl font-semibold">
          Change your password
        </h1>

        <p className="mt-2 text-sm text-muted">
          Set a new password before entering the auction workspace.
          Use at least 10 characters.
        </p>

        <input
          className="field mt-6"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="New password"
        />

        <input
          className="field mt-3"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Confirm new password"
        />

        {message && (
          <p className="mt-3 text-sm text-err" role="alert">
            {message}
          </p>
        )}

        <button
          className="key-primary mt-5 w-full"
          disabled={busy}
          type="submit"
        >
          {busy ? "Updating..." : "Update password"}
        </button>
      </form>
    </main>
  );
}
