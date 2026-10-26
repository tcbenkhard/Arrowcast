export function roundArrows(entered: readonly { arrowIndex: number; symbol: string }[], arrowsPerRound: number) {
  const arrows: (string | null)[] = Array.from({ length: arrowsPerRound }, () => null);
  for (const arrow of entered) arrows[arrow.arrowIndex - 1] = arrow.symbol;
  return arrows;
}
