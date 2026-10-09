"use client";
import { useEffect, useState } from "react";

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function Confirm() {
  const [message, setMessage] = useState("Logging you in…");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = safeNext(query.get("next"));
    const fail = () => window.location.replace(`/login?error=expired&next=${encodeURIComponent(next)}`);

    // Other kinds of login link are checked on the server.
    if (query.get("token_hash") || query.get("code")) {
      window.location.replace(`/auth/verify${window.location.search}`);
      return;
    }
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    // Don't leave the login details in the address bar or history.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!access_token || !refresh_token) return fail();

    fetch("/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token, refresh_token }),
    })
      .then((res) => (res.ok ? window.location.replace(next) : fail()))
      .catch(() => {
        setMessage("Couldn't log you in. Please try again.");
        fail();
      });
  }, []);

  return <p>{message}</p>;
}
