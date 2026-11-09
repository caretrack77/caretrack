export const DEFAULT_HEALTH_RANGES: Record<string, [number, number]> = {
  blood_pressure: [90, 180],
  blood_sugar: [70, 180],
  weight: [30, 300],
  heart_rate: [50, 120],
  temperature: [35, 38.5],
};

export function healthReadingIsOutOfRange(
  metricType: string,
  value: number,
  secondaryValue: number | undefined,
  min: number,
  max: number,
): boolean {
  return value < min || value > max ||
    (metricType === "blood_pressure" && secondaryValue != null && secondaryValue > max);
}

