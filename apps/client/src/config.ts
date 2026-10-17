/** Код комнаты из ссылки: только A–Z, 0–9, «_» и «-», не длиннее 32 знаков. */
export function cleanRoom(raw: string | null): string {
  const room = (raw ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  return room || "FRIENDS";
}
