"use client";

import { useEffect, useRef, useState } from "react";

const CLICKS_TO_UNLOCK = 13;
const RESET_DELAY_MS = 3000;
const UNLOCK_STORAGE_KEY = "dav_owner_unlocked";

type Props = {
  onUnlock: () => void;
};

export function MaintenanceGate({ onUnlock }: Props) {
  const [clickCount, setClickCount] = useState(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  function handleSecretClick() {
    setClickCount((prev) => {
      const next = prev + 1;
      if (next >= CLICKS_TO_UNLOCK) {
        try { localStorage.setItem(UNLOCK_STORAGE_KEY, "true"); } catch {}
        onUnlock();
        return 0;
      }
      return next;
    });
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setClickCount(0), RESET_DELAY_MS);
  }

  return (
    <div className="min-h-screen bg-[#090d0f] text-[#e0f0e8] flex items-center justify-center px-4 relative">
      {/* Owner unlock — 13 clicks within 3s of each other */}
      <div
        onClick={handleSecretClick}
        className="fixed bottom-0 left-0"
        style={{ width: 60, height: 60, zIndex: 50, touchAction: "manipulation" }}
        aria-hidden="true"
      />

      <div
        className="w-full max-w-md border border-[#1a2e25] bg-[#0d1512] overflow-hidden"
        style={{ borderRadius: "4px" }}
      >
        <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5a0, #ff3cac)" }} />
        <div className="px-8 py-10 text-center space-y-4">
          <span
            className="text-[15px] font-bold tracking-tight inline-block"
            style={{
              fontFamily: "var(--font-syne)",
              background: "linear-gradient(135deg, #00e5a0, #ff3cac)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            DAV PIPELINE
          </span>
          <h1 className="text-[16px] font-semibold text-[#e0f0e8]" style={{ fontFamily: "var(--font-syne)" }}>
            Temporarily Unavailable
          </h1>
          <p className="text-[12px] font-mono text-[#8aaa98] leading-relaxed">
            Access to this tool is currently restricted while we perform maintenance.
          </p>
          <p className="text-[11px] font-mono text-[#4a6a58] leading-relaxed">
            Please check back later.
          </p>
        </div>
        <div className="px-8 py-4 border-t border-[#1a2e25] text-center">
          <p className="text-[10px] font-mono text-[#4a6a58]">
            Need access? Contact the site owner.
          </p>
        </div>
      </div>
    </div>
  );
}
