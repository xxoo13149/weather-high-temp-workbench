export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const round2 = (value: number): number => Number.parseFloat(value.toFixed(2));

export const round4 = (value: number): number => Number.parseFloat(value.toFixed(4));

export const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

export const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle] ?? 0;
};

export const standardDeviation = (values: number[]): number => {
  if (values.length <= 1) {
    return 0;
  }

  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
};

const erf = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absolute);
  const polynomial =
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);

  return sign * (1 - polynomial * Math.exp(-(absolute ** 2)));
};

export const normalCdf = (value: number, meanValue: number, sigma: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(meanValue) || !Number.isFinite(sigma) || sigma <= 0) {
    return 0.5;
  }

  return 0.5 * (1 + erf((value - meanValue) / (sigma * Math.SQRT2)));
};

export const normalPdf = (value: number, meanValue: number, sigma: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(meanValue) || !Number.isFinite(sigma) || sigma <= 0) {
    return 0;
  }

  const exponent = -(((value - meanValue) / sigma) ** 2) / 2;
  return Math.exp(exponent) / (sigma * Math.sqrt(2 * Math.PI));
};
