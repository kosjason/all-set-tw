import { formatNumber } from "@/shared/format/financial";

export interface NetWorthValueAxis {
  domain: [number, number];
  ticks: number[];
  step: number;
}

const DEFAULT_TICK_COUNT = 4;
/** 單一數值或持平走勢時，上下各留的相對空間。 */
const FLAT_PADDING_RATIO = 0.02;
const MAX_UNIT_DECIMALS = 2;

/** 以 1、2、5 × 10^n 取不小於 1 元的刻度間距。 */
function niceStep(rawStep: number) {
  if (!(rawStep > 1)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const factor = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return factor * magnitude;
}

/**
 * 依資料範圍產生 y 軸 domain 與刻度。所有值相同時會上下補空間，
 * 避免 domain 退化成單一值而讓刻度全部落在同一個標籤。
 */
export function buildNetWorthValueAxis(
  values: Array<number | undefined>,
  tickCount = DEFAULT_TICK_COUNT,
): NetWorthValueAxis | null {
  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0) return null;

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * FLAT_PADDING_RATIO, 1);
    const allNonNegative = min >= 0;
    min -= padding;
    max += padding;
    if (allNonNegative && min < 0) min = 0;
  }

  const step = niceStep((max - min) / Math.max(1, tickCount));
  const lower = Math.floor(min / step) * step;
  const upper = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let index = 0; lower + index * step <= upper; index += 1) {
    ticks.push(lower + index * step);
  }
  return { domain: [lower, upper], ticks, step };
}

function decimalsForUnit(step: number, unit: number) {
  return Math.max(0, -Math.floor(Math.log10(step / unit)));
}

/**
 * 以刻度間距決定精度的精簡台幣格式：間距小於顯示單位時自動加小數，
 * 仍不足時退回完整數字，確保相鄰刻度標籤可以區分。
 */
export function formatNetWorthAxisValue(value: number, step: number) {
  const abs = Math.abs(value);
  const safeStep = step > 0 ? step : 1;
  if (abs >= 100_000_000) {
    const decimals = decimalsForUnit(safeStep, 100_000_000);
    if (decimals <= MAX_UNIT_DECIMALS)
      return `${(value / 100_000_000).toFixed(decimals)}億`;
  }
  if (abs >= 10_000) {
    const decimals = decimalsForUnit(safeStep, 10_000);
    if (decimals <= MAX_UNIT_DECIMALS)
      return `${(value / 10_000).toFixed(decimals)}萬`;
  }
  return formatNumber(Math.round(value));
}

/** 保險機制：移除與前一個保留刻度標籤相同的刻度。 */
export function dedupeAxisTicks(
  ticks: number[],
  format: (value: number) => string,
) {
  const kept: number[] = [];
  let previousLabel: string | undefined;
  for (const tick of ticks) {
    const label = format(tick);
    if (label === previousLabel) continue;
    kept.push(tick);
    previousLabel = label;
  }
  return kept;
}

/**
 * 走勢圖至少需要兩個日期才有意義；不足時回傳要顯示的說明文字。
 */
export function getNetWorthTrendNotice(
  pointsInRange: number,
  pointsOverall: number,
) {
  if (pointsInRange >= 2 || pointsInRange === 0) return null;
  return pointsOverall >= 2
    ? "此期間只有一天的快照，切換較長的期間可查看走勢。"
    : "資料累積中，至少需要兩天的快照才會顯示走勢。";
}
