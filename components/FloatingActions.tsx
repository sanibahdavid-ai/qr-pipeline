"use client";

import { useEffect, useState } from "react";
import { Copy, ArrowUp } from "lucide-react";
import { toast } from "sonner";

type Props = {
  onCopyAllQR: () => void;
  show: boolean;
};

export function FloatingActions({ onCopyAllQR, show }: Props) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 300);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  function handleCopy() {
    onCopyAllQR();
    toast.success("QR copié !");
  }

  return (
    <div className="fixed bottom-6 right-4 z-40 flex flex-col gap-2 items-end sm:hidden">
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono bg-[#2F2F2C] border border-[#44423D] text-[#B0ADA3] hover:border-[#5C5851] hover:text-[#F0EEE6] shadow-lg transition-none"
        style={{ borderRadius: "6px" }}
      >
        <Copy size={11} />
        Copy QR
      </button>
      {scrolled && (
        <button
          onClick={() => window.scrollTo({ top: 0 })}
          className="flex items-center justify-center w-8 h-8 bg-[#2F2F2C] border border-[#44423D] text-[#7D7A72] hover:text-[#F0EEE6] hover:border-[#5C5851] shadow-lg transition-none"
          style={{ borderRadius: "6px" }}
          title="Remonter"
        >
          <ArrowUp size={12} />
        </button>
      )}
    </div>
  );
}
