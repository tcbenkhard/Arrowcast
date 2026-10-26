export const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}

export function matchTarget(value: string, options: string[]): string | undefined {
  const key = normalize(value);
  const alias = key === '40cm' ? '40 cm blazoen (10-rings)' : key === 'dt' ? 'Dutch Target 40 cm (3-spot)' : undefined;
  if (alias) return options.find((name) => normalize(name) === normalize(alias));
  const exact = options.find((name) => normalize(name) === key);
  if (exact) return exact;
  const size = value.match(/(\d+)\s*cm/i)?.[1];
  if (/^\d+cm$/.test(key)) {
    const standard = options.find((name) => normalize(name) === `${size}cmblazoen10rings`);
    if (standard) return standard;
  }
  const ranked = options
    .filter((name) => !size || name.match(/(\d+)\s*cm/i)?.[1] === size)
    .map((name) => {
      const candidate = normalize(name);
      return {
        name,
        score: candidate.includes(key)
          ? key.length / candidate.length
          : 1 - distance(key, candidate) / Math.max(key.length, candidate.length),
      };
    })
    .sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < 0.5 || ranked[0].score === ranked[1]?.score) return undefined;
  return ranked[0].name;
}
