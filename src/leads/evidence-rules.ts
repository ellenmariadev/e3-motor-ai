export const RENTAL_PATTERN = /\b(alugad[oa]|alugo|aluguel)\b/i;
export const OWNERSHIP_PATTERN =
  /\b(?:é|e)\s+(?:minha|própria|propria)\b|\b(?:casa|imóvel)\s+(?:própria|propria|quitada)\b|\bquitada\b/i;

export function hasLiteralValue(value: unknown, excerpt: unknown): boolean {
  return (
    typeof value === "string" &&
    typeof excerpt === "string" &&
    excerpt.toLocaleLowerCase().includes(value.toLocaleLowerCase())
  );
}
