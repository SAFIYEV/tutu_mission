export function integerEnv(name: string, fallback: number, bounds: { min: number; max: number }) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(bounds.min, Math.min(bounds.max, value));
}
