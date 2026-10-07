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
    toast.success("Les 13 sections sont copiées");
  }

  return (
    <div className="fixed bottom-5 right-4 z-40 flex flex-col gap-2 items-end sm:hidden">
      {scrolled && (
        <button
          onClick={() => window.scrollTo({ top: 0 })}
          className="w-11 h-11 rounded-full grid place-items-center bg-raised border border-line text-muted shadow-[0_12px_30px_-8px_rgba(0,0,0,0.7)]"
          title="Remonter"
          aria-label="Remonter"
        >
          <ArrowUp size={17} />
        </button>
      )}
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-2 h-12 px-5 rounded-full bg-accent-deep text-white text-[15px] font-semibold shadow-[0_16px_36px_-10px_rgba(44,104,230,0.7)]"
      >
        <Copy size={16} />
        Tout copier
      </button>
    </div>
  );
}
