/**
 * Window-level probability that an ECG alert fires.
 *
 * The prior constants below were set before fitting this file:
 * point guess 0.28, low confidence, strength of 8 pseudo-windows.
 * They are not revised after seeing the strip.
 */

export const PRIOR_MEAN = 0.28;
export const PRIOR_STRENGTH = 8;
export const PRIOR_ALPHA = 2.24;
export const PRIOR_BETA = 5.76;

export const WINDOW_S = 5;
export const LOCKED_HOLDOUT_S = 20;
export const LOCKED_HR_BPM = 85;
export const LOCKED_IRREG = 0.2;
export const MIN_INTERVALS = 2;
export const MIN_RR_S = 0.25;
export const MAX_RR_S = 2.5;

export type SplitName = "train" | "test";

export type WindowBase = {
  index: number;
  startS: number;
  endS: number;
  split: SplitName;
  rr: number[];
};

export type ScoredWindow = WindowBase & {
  status: "scored" | "unscored";
  meanHr: number | null;
  relDev: number | null;
  event: boolean | null;
};

export type Fit = {
  trainN: number;
  trainK: number;
  testN: number;
  testK: number;
  unscored: number;
  alpha: number;
  beta: number;
  mean: number;
  lower: number;
  upper: number;
  priorMean: number;
  priorLower: number;
  priorUpper: number;
  brier: number | null;
  logLoss: number | null;
  priorBrier: number | null;
  coinBrier: number | null;
  splitRule: "last-20s" | "last-third";
};

export type TracePoint = { t: number; mV: number };

export type Report = {
  error: string | null;
  skipped: number;
  nSamples: number;
  durationS: number;
  fsHz: number | null;
  timingWarning: boolean;
  nPeaks: number;
  rrKept: number;
  rrRejected: number;
  meanHr: number | null;
  minInstHr: number | null;
  maxInstHr: number | null;
  rrCv: number | null;
  maxRelDev: number | null;
  trace: TracePoint[];
  peaks: TracePoint[];
  bases: WindowBase[];
  locked: Fit | null;
  lockedWindows: ScoredWindow[];
};

const EMPTY: Report = {
  error: null,
  skipped: 0,
  nSamples: 0,
  durationS: 0,
  fsHz: null,
  timingWarning: false,
  nPeaks: 0,
  rrKept: 0,
  rrRejected: 0,
  meanHr: null,
  minInstHr: null,
  maxInstHr: null,
  rrCv: null,
  maxRelDev: null,
  trace: [],
  peaks: [],
  bases: [],
  locked: null,
  lockedWindows: [],
};

function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/^"|"$/g, "");
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === "nan" || lower === "null" || lower === "na" || text === "-") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function pstdev(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function lgamma(z: number): number {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  let x = 0.99999999999980993;
  let zLocal = z - 1;
  for (let i = 0; i < p.length; i += 1) x += p[i] / (zLocal + i + 1);
  const t = zLocal + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zLocal + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(x: number, a: number, b: number): number {
  const fpmin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

export function betaQuantile(p: number, a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return Number.NaN;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const logf = (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lgamma(a) + lgamma(b) - lgamma(a + b));
  const value = Math.exp(logf);
  return Number.isFinite(value) ? value : 0;
}

export function densitySeries(a: number, b: number, steps = 90): { x: number; density: number }[] {
  const points: { x: number; density: number }[] = [];
  for (let i = 1; i < steps; i += 1) {
    const x = i / steps;
    points.push({ x, density: betaPdf(x, a, b) });
  }
  return points;
}

export function detectPeakIndices(mV: number[], fs: number): number[] {
  const n = mV.length;
  if (n < 3 || !(fs > 0)) return [];
  const width = Math.max(3, Math.round(0.2 * fs));
  const half = Math.floor(width / 2);
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + mV[i];
  const detrended = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    detrended[i] = mV[i] - mean;
  }
  const smooth = detrended.slice();
  for (let i = 1; i < n - 1; i += 1) {
    smooth[i] = (detrended[i - 1] + detrended[i] + detrended[i + 1]) / 3;
  }
  const prominence = Math.max(0.1, 0.5 * pstdev(smooth));
  const distance = Math.max(1, Math.round(0.4 * fs));
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i += 1) {
    if (smooth[i] >= smooth[i - 1] && smooth[i] > smooth[i + 1] && smooth[i] >= prominence) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= distance) peaks.push(i);
      else if (smooth[i] > smooth[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
    }
  }
  return peaks;
}

export function scoreWindow(base: WindowBase, hrLimit: number, irregLimit: number): ScoredWindow {
  if (base.rr.length < MIN_INTERVALS) {
    return { ...base, status: "unscored", meanHr: null, relDev: null, event: null };
  }
  const meanRr = base.rr.reduce((sum, value) => sum + value, 0) / base.rr.length;
  const mid = median(base.rr);
  if (!(meanRr > 0) || !(mid > 0)) {
    return { ...base, status: "unscored", meanHr: null, relDev: null, event: null };
  }
  const meanHr = 60 / meanRr;
  const relDev = Math.max(...base.rr.map((value) => Math.abs(value - mid) / mid));
  const event = meanHr > hrLimit || relDev > irregLimit;
  return { ...base, status: "scored", meanHr, relDev, event };
}

export function scoreAll(bases: WindowBase[], hrLimit: number, irregLimit: number): ScoredWindow[] {
  return bases.map((base) => scoreWindow(base, hrLimit, irregLimit));
}

function meanSquared(pairs: { p: number; y: number }[]): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((sum, pair) => sum + (pair.p - pair.y) ** 2, 0) / pairs.length;
}

function meanLogLoss(pairs: { p: number; y: number }[]): number | null {
  if (pairs.length === 0) return null;
  return (
    pairs.reduce((sum, pair) => {
      const p = Math.min(1 - 1e-12, Math.max(1e-12, pair.p));
      return sum - (pair.y * Math.log(p) + (1 - pair.y) * Math.log(1 - p));
    }, 0) / pairs.length
  );
}

export function summarize(windows: ScoredWindow[], splitRule: Fit["splitRule"]): Fit {
  const train = windows.filter((window) => window.split === "train" && window.status === "scored");
  const test = windows.filter((window) => window.split === "test" && window.status === "scored");
  const trainK = train.filter((window) => window.event).length;
  const testK = test.filter((window) => window.event).length;
  const alpha = PRIOR_ALPHA + trainK;
  const beta = PRIOR_BETA + (train.length - trainK);
  const mean = alpha / (alpha + beta);
  const priorMean = PRIOR_ALPHA / (PRIOR_ALPHA + PRIOR_BETA);
  const testPairs = test.map((window) => ({ p: mean, y: window.event ? 1 : 0 }));
  const scoredTrain = train.length > 0;
  return {
    trainN: train.length,
    trainK,
    testN: test.length,
    testK,
    unscored: windows.filter((window) => window.status === "unscored").length,
    alpha,
    beta,
    mean,
    lower: betaQuantile(0.025, alpha, beta),
    upper: betaQuantile(0.975, alpha, beta),
    priorMean,
    priorLower: betaQuantile(0.025, PRIOR_ALPHA, PRIOR_BETA),
    priorUpper: betaQuantile(0.975, PRIOR_ALPHA, PRIOR_BETA),
    brier: scoredTrain ? meanSquared(testPairs) : null,
    logLoss: scoredTrain ? meanLogLoss(testPairs) : null,
    priorBrier: scoredTrain ? meanSquared(testPairs.map((pair) => ({ p: priorMean, y: pair.y }))) : null,
    coinBrier: scoredTrain ? meanSquared(testPairs.map((pair) => ({ p: 0.5, y: pair.y }))) : null,
    splitRule,
  };
}

/** Intercept-only logistic log likelihood. With no alerts this rises as the intercept falls. */
export function interceptLogLik(windows: ScoredWindow[], intercept: number): number | null {
  const train = windows.filter((window) => window.split === "train" && window.status === "scored");
  if (train.length === 0) return null;
  const p = Math.min(1 - 1e-12, Math.max(1e-12, 1 / (1 + Math.exp(-intercept))));
  return train.reduce((sum, window) => {
    const y = window.event ? 1 : 0;
    return sum + y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }, 0);
}

function decimateMinMax(times: number[], mV: number[], buckets: number): TracePoint[] {
  if (times.length === 0) return [];
  if (times.length <= buckets * 2) {
    return times.map((t, index) => ({ t, mV: mV[index] }));
  }
  const size = Math.ceil(times.length / buckets);
  const out: TracePoint[] = [];
  for (let start = 0; start < times.length; start += size) {
    const end = Math.min(times.length, start + size);
    let minI = start;
    let maxI = start;
    for (let i = start + 1; i < end; i += 1) {
      if (mV[i] < mV[minI]) minI = i;
      if (mV[i] > mV[maxI]) maxI = i;
    }
    const first = minI <= maxI ? minI : maxI;
    const second = minI <= maxI ? maxI : minI;
    out.push({ t: times[first], mV: mV[first] });
    if (second !== first) out.push({ t: times[second], mV: mV[second] });
  }
  return out;
}

export function analyzeJson(data: unknown): Report {
  if (!Array.isArray(data) || data.length === 0) return { ...EMPTY, error: "The JSON data is empty." };

  if (!data.some((row) => row && typeof row === "object" && "Time (ms)" in row && "Amplitude (mV)" in row)) {
    return {
      ...EMPTY,
      error: "The JSON data needs Time (ms) and Amplitude (mV) fields.",
    };
  }

  const times: number[] = [];
  const amps: number[] = [];
  let skipped = 0;
  for (const row of data) {
    if (!row || typeof row !== "object") {
      skipped += 1;
      continue;
    }
    const record = row as Record<string, unknown>;
    const time = parseNumber(String(record["Time (ms)"] ?? ""));
    const amp = parseNumber(String(record["Amplitude (mV)"] ?? ""));
    if (time === null || amp === null) {
      skipped += 1;
      continue;
    }
    if (times.length > 0 && time <= times[times.length - 1]) {
      skipped += 1;
      continue;
    }
    times.push(time);
    amps.push(amp);
  }

  if (times.length < 3) {
    return {
      ...EMPTY,
      skipped,
      nSamples: times.length,
      error: "Not enough numeric samples to detect beats.",
    };
  }

  const dt: number[] = [];
  for (let i = 1; i < times.length; i += 1) dt.push(times[i] - times[i - 1]);
  const medianDt = median(dt);
  const fsHz = medianDt > 0 ? 1000 / medianDt : Number.NaN;
  const minDt = Math.min(...dt);
  const maxDt = Math.max(...dt);
  const timingWarning = !(minDt > 0) || maxDt / minDt > 1.05;
  const durationS = (times[times.length - 1] - times[0]) / 1000;
  const timeS = times.map((time) => time / 1000);
  const peakIdx = Number.isFinite(fsHz) ? detectPeakIndices(amps, fsHz) : [];
  const peakTimes = peakIdx.map((index) => timeS[index]);

  let rrRejected = 0;
  const rrKept: { endS: number; rr: number }[] = [];
  for (let i = 1; i < peakTimes.length; i += 1) {
    const rr = peakTimes[i] - peakTimes[i - 1];
    if (rr < MIN_RR_S || rr > MAX_RR_S) {
      rrRejected += 1;
      continue;
    }
    rrKept.push({ endS: peakTimes[i], rr });
  }

  const nWindows = Math.max(0, Math.floor((durationS + 1e-6) / WINDOW_S));
  const span = nWindows * WINDOW_S;
  const splitRule: Fit["splitRule"] =
    span > LOCKED_HOLDOUT_S + 2 * WINDOW_S ? "last-20s" : "last-third";
  const testStart =
    splitRule === "last-20s" ? span - LOCKED_HOLDOUT_S : span - Math.ceil(nWindows / 3) * WINDOW_S;

  const bases: WindowBase[] = [];
  for (let index = 0; index < nWindows; index += 1) {
    const startS = index * WINDOW_S;
    const endS = startS + WINDOW_S;
    bases.push({
      index,
      startS,
      endS,
      split: startS >= testStart ? "test" : "train",
      rr: rrKept.filter((item) => item.endS >= startS && item.endS < endS).map((item) => item.rr),
    });
  }

  const rrValues = rrKept.map((item) => item.rr);
  const instHr = rrValues.map((rr) => 60 / rr);
  const mid = rrValues.length ? median(rrValues) : Number.NaN;
  const lockedWindows = scoreAll(bases, LOCKED_HR_BPM, LOCKED_IRREG);
  const locked = bases.length ? summarize(lockedWindows, splitRule) : null;

  return {
    error: null,
    skipped,
    nSamples: times.length,
    durationS,
    fsHz: Number.isFinite(fsHz) ? fsHz : null,
    timingWarning,
    nPeaks: peakIdx.length,
    rrKept: rrValues.length,
    rrRejected,
    meanHr: rrValues.length ? 60 / (rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length) : null,
    minInstHr: instHr.length ? Math.min(...instHr) : null,
    maxInstHr: instHr.length ? Math.max(...instHr) : null,
    rrCv: rrValues.length ? pstdev(rrValues) / (rrValues.reduce((s, v) => s + v, 0) / rrValues.length) : null,
    maxRelDev:
      rrValues.length && mid > 0 ? Math.max(...rrValues.map((rr) => Math.abs(rr - mid) / mid)) : null,
    trace: decimateMinMax(timeS, amps, 420),
    peaks: peakIdx.map((index) => ({ t: timeS[index], mV: amps[index] })),
    bases,
    locked,
    lockedWindows,
  };
}
