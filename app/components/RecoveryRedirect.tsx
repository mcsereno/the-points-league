"use client";

import { useEffect } from "react";

export function RecoveryRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.get("type") === "recovery" && params.has("access_token")) {
      window.location.replace(`/reset-password${window.location.hash}`);
    }
  }, []);

  return null;
}
