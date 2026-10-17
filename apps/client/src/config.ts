/**
 * Код комнаты из ссылки: только A–Z, 0–9, «_» и «-», не длиннее 32 знаков.
 * PeerJS принимает ID, только если разделители стоят по одному между буквами и цифрами,
 * поэтому серии «-» и «_» сжимаем до первого знака и срезаем по краям.
 */
export function cleanRoom(raw: string | null): string {
  const room = (raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .replace(/[-_]+/g, (run) => run[0]!)
    .replace(/^[-_]|[-_]$/g, "")
    .slice(0, 32)
    .replace(/[-_]$/, "");
  return room || "FRIENDS";
}

/** PeerJS-ID хоста комнаты. Код комнаты должен пройти через cleanRoom. */
export function hostPeerId(room: string): string {
  return `doodlemagic-nt-${room.toLowerCase()}-host`;
}

/** Грубое деление по User-Agent: этого хватает, чтобы различить прогоны одного человека с ПК и с телефона. */
export function deviceKind(ua: string): string {
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? "телефон" : "ПК";
}

/** navigator.connection есть не во всех браузерах; type («wifi», «cellular») бывает только на телефонах. */
export function netKind(conn: { type?: string; effectiveType?: string } | undefined): string {
  return conn?.type ?? conn?.effectiveType ?? "?";
}
