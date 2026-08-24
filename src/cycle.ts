/**
 * 5-Week Steady Growth Cycle — block state, week typing, and the stores that
 * hang off it (nutrition targets, reassessments, daily check-ins).
 *
 * The cycle is defined by a single start date (a Monday). Everything else —
 * which week you're in, what type of week it is, whether Saturday is a swim or
 * a pull — is derived from that date, so nothing rots when a block rolls over.
 */

import programmeData from './data/programme.json';
import type { Session, Exercise } from './types';

export type WeekType = 'baseline' | 'progressive' | 'deload' | 'reassess';

export interface WeekTypeMeta {
  label: string;
  short: string;
  volume_multiplier: number;
  load_delta_kg: number;
  accessory_extra_set?: boolean;
  rpe_cap?: number;
}

const cycleCfg = (programmeData as any).cycle ?? {};
const CYCLE_LENGTH: number = cycleCfg.length_weeks ?? 5;
const DEFAULT_START: string = cycleCfg.default_start_date ?? '2026-07-20';

const WEEK_TYPES: Record<string, WeekType> = cycleCfg.week_types ?? {
  '1': 'baseline', '2': 'baseline', '3': 'progressive', '4': 'deload', '5': 'reassess',
};

export const WEEK_TYPE_META: Record<WeekType, WeekTypeMeta> = cycleCfg.week_type_meta ?? {
  baseline: { label: 'Baseline', short: 'Run as written.', volume_multiplier: 1, load_delta_kg: 0 },
  progressive: { label: 'Progressive Push', short: '+2.5kg or +1 set.', volume_multiplier: 1, load_delta_kg: 2.5 },
  deload: { label: 'Deload', short: 'Volume cut ~40%.', volume_multiplier: 0.6, load_delta_kg: 0 },
  reassess: { label: 'Reassess', short: 'Retest and restart.', volume_multiplier: 1, load_delta_kg: 0 },
};

// ─── Storage keys ────────────────────────────────────────────────────────────

const K_START = 'gsb_cycle_start';
const K_NUTRITION = 'gsb_nutrition';
const K_REASSESS = 'gsb_reassessments';
const K_CHECKINS = 'gsb_checkins';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── Cycle start date ────────────────────────────────────────────────────────

/** Monday on or before the given date. */
export function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay();            // 0 = Sun
  const back = dow === 0 ? 6 : dow - 1;
  out.setDate(out.getDate() - back);
  return out;
}

export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function getCycleStart(): string {
  const stored = localStorage.getItem(K_START);
  if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  return DEFAULT_START;
}

export function setCycleStart(iso: string) {
  try { localStorage.setItem(K_START, iso); } catch {}
}

/** Restart the block from the Monday of the week containing `from`. */
export function restartCycle(from = new Date()): string {
  const iso = toISODate(mondayOf(from));
  setCycleStart(iso);
  return iso;
}

// ─── Cycle state ─────────────────────────────────────────────────────────────

export interface CycleState {
  /** 1-based block number since the stored start date. */
  cycleNumber: number;
  /** 1..5 */
  week: number;
  weekType: WeekType;
  meta: WeekTypeMeta;
  /** 1 = Monday … 7 = Sunday */
  dayOfWeek: number;
  weekStart: Date;
  weekEnd: Date;
  cycleLength: number;
  /** Weeks left in this block, including the current one. */
  weeksRemaining: number;
  /** True on the reassess week — drives the retest prompt. */
  isReassessWeek: boolean;
  isDeloadWeek: boolean;
}

export function getCycleState(now = new Date(), startISO = getCycleStart()): CycleState {
  const start = mondayOf(parseISODate(startISO));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;

  const daysElapsed = Math.floor((today.getTime() - start.getTime()) / msPerDay);
  const weeksElapsed = Math.floor(Math.max(0, daysElapsed) / 7);

  const cycleNumber = Math.floor(weeksElapsed / CYCLE_LENGTH) + 1;
  const week = (weeksElapsed % CYCLE_LENGTH) + 1;
  const weekType = WEEK_TYPES[String(week)] ?? 'baseline';
  const meta = WEEK_TYPE_META[weekType];

  const weekStart = new Date(start);
  weekStart.setDate(weekStart.getDate() + weeksElapsed * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const jsDow = today.getDay();
  const dayOfWeek = jsDow === 0 ? 7 : jsDow;

  return {
    cycleNumber,
    week,
    weekType,
    meta,
    dayOfWeek,
    weekStart,
    weekEnd,
    cycleLength: CYCLE_LENGTH,
    weeksRemaining: CYCLE_LENGTH - week + 1,
    isReassessWeek: weekType === 'reassess',
    isDeloadWeek: weekType === 'deload',
  };
}

let memo: { key: string; state: CycleState } | null = null;

/** Memoised state for "right now" — safe to call from render paths. */
export function currentCycle(): CycleState {
  const start = getCycleStart();
  const key = `${toISODate(new Date())}|${start}`;
  if (memo?.key !== key) memo = { key, state: getCycleState(new Date(), start) };
  return memo.state;
}

/** Drops the memo — call after changing the cycle start date. */
export function invalidateCycle() {
  memo = null;
}

/** Week type for an arbitrary week index (1-based) — used by the week strip. */
export function weekTypeAt(week: number): WeekType {
  return WEEK_TYPES[String(((week - 1) % CYCLE_LENGTH) + 1)] ?? 'baseline';
}

// ─── Week-type application ───────────────────────────────────────────────────

const MAIN_LIFTS = [
  'barbell bench press',
  'overhead press',
  'barbell bent-over row',
  'barbell back squat',
  'romanian deadlift',
];

export function isMainLift(name: string): boolean {
  const n = name.toLowerCase();
  return MAIN_LIFTS.some(m => n.includes(m));
}

/**
 * Applies the current week type to a session's prescribed volume.
 *
 * Deload cuts sets by the configured multiplier (~40% down), floored at 2 so a
 * movement never vanishes. Progressive adds one set to accessory work — main
 * lifts take their progression as load, not volume.
 */
export function scaleSessionForWeek(session: Session, weekType: WeekType): Session {
  const meta = WEEK_TYPE_META[weekType];
  if (!session?.exercises?.length) return session;
  if (weekType === 'baseline' || weekType === 'reassess') return session;

  const exercises: Exercise[] = session.exercises.map(ex => {
    const baseSets = ex.sets ?? 1;
    let sets = baseSets;

    if (weekType === 'deload') {
      sets = Math.max(2, Math.round(baseSets * (meta.volume_multiplier ?? 0.6)));
    } else if (weekType === 'progressive' && meta.accessory_extra_set && !isMainLift(ex.name)) {
      sets = baseSets + 1;
    }

    return sets === baseSets ? ex : { ...ex, sets, _baseSets: baseSets } as Exercise;
  });

  return { ...session, exercises };
}

/** Total prescribed sets, before and after the week type is applied. */
export function sessionVolume(session: Session, weekType: WeekType): { base: number; scaled: number } {
  const base = (session?.exercises ?? []).reduce((n, e) => n + (e.sets ?? 1), 0);
  const scaled = (scaleSessionForWeek(session, weekType).exercises ?? []).reduce((n, e) => n + (e.sets ?? 1), 0);
  return { base, scaled };
}

// ─── Nutrition targets (adjustable, set at reassessment) ─────────────────────

export interface NutritionTargets {
  calories: number;
  protein: number;
  updatedAt: string;
  /** Which cycle these were set for. */
  setForCycle?: number;
}

const nutritionCfg = (programmeData as any).nutrition ?? {};

export function getNutrition(): NutritionTargets {
  return readJSON<NutritionTargets>(K_NUTRITION, {
    calories: nutritionCfg.default_calorie_target ?? 2900,
    protein: nutritionCfg.default_protein_target_g ?? 175,
    updatedAt: '',
  });
}

export function setNutrition(t: Partial<NutritionTargets>) {
  const next: NutritionTargets = {
    ...getNutrition(),
    ...t,
    updatedAt: new Date().toISOString(),
  };
  writeJSON(K_NUTRITION, next);
  return next;
}

// ─── Reassessment time series ────────────────────────────────────────────────

export interface LiftRetest {
  name: string;
  weight: number;
  reps: number;
}

export interface Reassessment {
  date: string;            // ISO date
  cycleNumber: number;
  lifts: LiftRetest[];
  waistCm: number | null;
  avgWeightKg: number | null;
  calories: number;
  protein: number;
}

export function getReassessments(): Reassessment[] {
  return readJSON<Reassessment[]>(K_REASSESS, []);
}

export function addReassessment(r: Reassessment) {
  const all = getReassessments().filter(x => x.date !== r.date);
  all.push(r);
  all.sort((a, b) => a.date.localeCompare(b.date));
  writeJSON(K_REASSESS, all);
  return all;
}

/** Has the current block's reassessment already been recorded? */
export function hasReassessedThisCycle(state = getCycleState()): boolean {
  return getReassessments().some(r => r.cycleNumber === state.cycleNumber);
}

export interface NutritionSuggestion {
  deltaKcal: number;
  reason: string;
  ratePerWeekKg: number | null;
}

/**
 * Applies the weight-trend rule from the block spec:
 *   gaining faster than ~0.25-0.5 lb/wk  → cut 100-150 kcal
 *   flat for 2+ consecutive weeks        → add 100-150 kcal
 * Needs at least two reassessments with a bodyweight recorded.
 */
export function suggestCalorieAdjustment(
  history = getReassessments(),
  pendingWeightKg?: number | null,
): NutritionSuggestion | null {
  const withWeight = history.filter(r => typeof r.avgWeightKg === 'number' && r.avgWeightKg! > 0);
  const series = [...withWeight];

  if (typeof pendingWeightKg === 'number' && pendingWeightKg > 0) {
    series.push({ ...(series[series.length - 1] ?? ({} as Reassessment)), date: 'pending', avgWeightKg: pendingWeightKg } as Reassessment);
  }
  if (series.length < 2) return null;

  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  const weeksBetween =
    curr.date === 'pending' || prev.date === 'pending'
      ? 5
      : Math.max(1, Math.round((parseISODate(curr.date).getTime() - parseISODate(prev.date).getTime()) / (7 * 24 * 3600 * 1000)));

  const delta = (curr.avgWeightKg ?? 0) - (prev.avgWeightKg ?? 0);
  const rate = delta / weeksBetween;

  const rule = (nutritionCfg.adjustment_rule ?? {}) as any;
  const fastThreshold = rule.gain_too_fast?.threshold_kg_per_week ?? 0.23;
  const fastDelta = rule.gain_too_fast?.action_kcal ?? -125;
  const stallDelta = rule.stalled?.action_kcal ?? 125;

  if (rate > fastThreshold) {
    return {
      deltaKcal: fastDelta,
      ratePerWeekKg: rate,
      reason: `Gaining ${rate.toFixed(2)} kg/week — faster than the 0.25-0.5 lb/week ceiling. Cut ${Math.abs(fastDelta)} kcal.`,
    };
  }
  if (Math.abs(rate) < 0.05) {
    return {
      deltaKcal: stallDelta,
      ratePerWeekKg: rate,
      reason: `Weight flat across ${weeksBetween} week${weeksBetween === 1 ? '' : 's'} — add ${stallDelta} kcal.`,
    };
  }
  return {
    deltaKcal: 0,
    ratePerWeekKg: rate,
    reason: `Gaining ${rate.toFixed(2)} kg/week — inside the target band. Hold calories.`,
  };
}

// ─── Daily check-in log ──────────────────────────────────────────────────────

export type CheckInStatus = 'done' | 'missed';

export interface CheckIn {
  date: string;          // ISO date — one entry per day
  status: CheckInStatus;
  reason: string;        // required when missed
  fix: string;           // required when missed — the same-day correction
  sessionKey?: string;
  timestamp: string;     // ISO datetime
}

export function getCheckIns(): CheckIn[] {
  return readJSON<CheckIn[]>(K_CHECKINS, []);
}

export function getCheckIn(dateISO: string): CheckIn | null {
  return getCheckIns().find(c => c.date === dateISO) ?? null;
}

/** Upserts the check-in for its date. Later entries win. */
export function saveCheckIn(entry: Omit<CheckIn, 'timestamp'>): CheckIn[] {
  const all = getCheckIns().filter(c => c.date !== entry.date);
  all.push({ ...entry, timestamp: new Date().toISOString() });
  all.sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(K_CHECKINS, all);
  return all;
}

/** Consecutive days ending today with a `done` check-in. */
export function checkInStreak(now = new Date()): number {
  const byDate = new Map(getCheckIns().map(c => [c.date, c]));
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 400; i++) {
    const entry = byDate.get(toISODate(cursor));
    if (entry?.status === 'done') streak++;
    else if (i > 0 || entry) break;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Check-ins falling inside the current cycle week. */
export function weekCheckIns(state = getCycleState()): CheckIn[] {
  const start = toISODate(state.weekStart);
  const end = toISODate(state.weekEnd);
  return getCheckIns().filter(c => c.date >= start && c.date <= end);
}
