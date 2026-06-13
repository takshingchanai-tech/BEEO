"use client";

// Email-embedded dashboard links point at SITE_URL/api-login?token=… (static page),
// which forwards to the api worker's verify endpoint. Keeps email links on the
// product domain.

import { useEffect } from "react";
import { Suspense } from "react";
import { API_BASE } from "../../lib/config";

function Forwarder() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    window.location.replace(
      token ? `${API_BASE}/api/login/verify?token=${token}` : "/reconnect",
    );
  }, []);
  return <main className="p-12 text-center">…</main>;
}

export default function Page() {
  return (
    <Suspense>
      <Forwarder />
    </Suspense>
  );
}
