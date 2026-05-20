export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function sanitizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function wordStats(text: string): { words: number; duration: string } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const totalSec = Math.round((words * 60) / 130);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const duration =
    min === 0
      ? `${totalSec}s`
      : sec === 0
      ? `${min}min`
      : `${min}min${String(sec).padStart(2, "0")}s`;
  return { words, duration };
}
