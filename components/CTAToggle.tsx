"use client";

import { Bell } from "lucide-react";

type Props = {
  enabled: boolean;
  onToggle: (v: boolean) => void;
};

export function CTAToggle({ enabled, onToggle }: Props) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      title={enabled ? "CTA abonnement activé — cliquer pour désactiver" : "CTA abonnement désactivé"}
      className={`fixed bottom-24 right-4 sm:bottom-6 sm:right-4 z-50 w-7 h-7 flex items-center justify-center border shadow-sm transition-none ${
        enabled
          ? "border-[#D97757] text-[#D97757] bg-[#2F2F2C]"
          : "border-[#3A3A36] text-[#5C5851] bg-[#262624] opacity-40 hover:opacity-70"
      }`}
      style={{ borderRadius: "5px" }}
    >
      <Bell size={12} />
    </button>
  );
}
