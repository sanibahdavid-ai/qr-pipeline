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
        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono bg-[#0d1420] border border-[#1a2942] text-[#7a9ac2] hover:border-[#00b4ff] hover:text-[#00b4ff] shadow-lg transition-none"
        style={{ borderRadius: "2px" }}
      >
        <Copy size={11} />
        Copy QR
      </button>
      {scrolled && (
        <button
          onClick={() => window.scrollTo({ top: 0 })}
          className="flex items-center justify-center w-8 h-8 bg-[#0d1420] border border-[#1a2942] text-[#4a6a8a] hover:text-[#00b4ff] hover:border-[#00b4ff] shadow-lg transition-none"
          style={{ borderRadius: "2px" }}
          title="Remonter"
        >
          <ArrowUp size={12} />
        </button>
      )}
    </div>
  );
}
