"use client";

import { useState } from "react";

export function RebuyButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const rebuy = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/rebuys", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The rebuy could not be completed.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The rebuy could not be completed.");
      setLoading(false);
    }
  };

  return <div className="rebuy-action">
    <button className="button button-primary" onClick={rebuy} disabled={loading}>{loading ? "Processing rebuy" : "Use rebuy"}</button>
    {message && <small>{message}</small>}
  </div>;
}
