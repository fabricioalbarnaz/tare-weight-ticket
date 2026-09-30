export function calculateNetWeightKg(entryWeightKg: number, exitWeightKg: number): number {
  const diff = Math.abs(entryWeightKg - exitWeightKg);
  return Math.round(diff * 100) / 100;
}
