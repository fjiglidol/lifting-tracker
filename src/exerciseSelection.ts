import { Programme, Session, Exercise } from './types';
import type { HistorySession } from './data/seedHistory';
import { getCycleState } from './cycle';

// ── Schedule mapping (5-Week Steady Growth Cycle) ──────────────────────────
//
// Saturday alternates week to week: swim intervals on odd cycle weeks, Pull B
// on even ones. Use getDayToSession() / getWeekSchedule() rather than the
// static maps when that alternation matters.

export function saturdaySession(cycleWeek: number): string {
  return cycleWeek % 2 === 1 ? 'swim_intervals' : 'pull_b';
}

// ── Temporary plan override: Re-Entry Block — Hong Kong → Seoul ────────────
//
// Day 3 of a six-hour eastward shift, fourteen weeks since the last barbell
// session, and a flight to Seoul on ~Sep 5. Jet lag breaks self-assessment, and
// self-assessment is what the Recovery Gauge and every RPE ceiling run on — so
// this block is written date by date, in kilograms, in advance, and the app
// serves it that way rather than resolving a rotation on the day.
//
// Details live in workouts/2026-08-31-hk-seoul-reentry-block.md and
// programme.temporary_plan. Falls back to the gym split on its own after
// REENTRY_BLOCK_UNTIL, with nothing to undo.
//
// The Road Block and its field sessions (Crossings, The Grid) are closed —
// no pitch and no treadmill in Hong Kong, and there is a barbell instead.

export const REENTRY_BLOCK_FROM = '2026-08-31';
export const REENTRY_BLOCK_UNTIL = '2026-09-13';

/** Dated schedule. Both block weeks are covered in full, so there are no gaps. */
export const REENTRY_SCHEDULE: Record<string, string> = {
  // Hong Kong — the written week
  '2026-08-31': 'reentry_a1',     // Mon — walk 40 min from 10:00 + Re-Entry A @ 50%
  '2026-09-01': 'reentry_walk',   // Tue — rest day: walk 60 min, dead hangs on any bar
  '2026-09-02': 'reentry_b2',     // Wed — walk 30 min from 08:00 + Re-Entry B @ 60%
  '2026-09-03': 'reentry_run',    // Thu — the one easy run, before 07:30 or after 19:30
  '2026-09-04': 'reentry_a3',     // Fri — Re-Entry A @ 70%, pack after
  '2026-09-05': 'reentry_travel', // Sat — rest day: fly to Seoul
  '2026-09-06': 'reentry_walk',   // Sun — walk + orient. Find the gym, find the river.

  // Seoul — provisional, rewrite once the dates and the gym are known
  '2026-09-07': 'seoul_upper_a',
  '2026-09-08': 'reentry_run',
  '2026-09-09': 'seoul_lower',
  '2026-09-10': 'reentry_walk',
  '2026-09-11': 'seoul_upper_b',
  '2026-09-12': 'seoul_run_long',
  '2026-09-13': 'day_7',
};

const REENTRY_LABELS: Record<string, string> = {
  reentry_a1: 'A @ 50%',
  reentry_b2: 'B @ 60%',
  reentry_a3: 'A @ 70%',
  reentry_walk: 'Walk',
  reentry_run: 'Run',
  reentry_travel: 'Travel',
  seoul_upper_a: 'Upper A',
  seoul_lower: 'Lower',
  seoul_upper_b: 'Upper B',
  seoul_run_long: 'Long Run',
  day_7: 'Rest',
};

/** Local YYYY-MM-DD — avoids the UTC shift toISOString() would introduce. */
function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isReentryBlockActive(now = new Date()): boolean {
  const today = localISODate(now);
  return today >= REENTRY_BLOCK_FROM && today <= REENTRY_BLOCK_UNTIL;
}

/** The seven dates of the Monday-start week containing `now`, as local YYYY-MM-DD. */
function weekDates(now: Date): string[] {
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return localISODate(d);
  });
}

/**
 * dow → session key for the block week containing `now`, or null when that week
 * falls outside the block. Dates the block does not cover keep the normal split,
 * so a half-covered week degrades rather than breaking.
 */
export function reentryWeekMap(now = new Date()): Record<number, string> | null {
  if (!isReentryBlockActive(now)) return null;
  const out: Record<number, string> = {};
  for (const date of weekDates(now)) {
    const key = REENTRY_SCHEDULE[date];
    if (!key) continue;
    const [y, m, d] = date.split('-').map(Number);
    out[new Date(y, m - 1, d).getDay()] = key;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function getDayToSession(cycleWeek = getCycleState().week, now = new Date()): Record<number, string> {
  const base: Record<number, string> = {
    0: 'day_7',                       // Sun — Full rest
    1: 'push_a',                      // Mon — Push A (Heavy)
    2: 'pull_a',                      // Tue — Pull A (Heavy)
    3: 'swim_steady',                 // Wed — Swim: steady state + core
    4: 'legs_core',                   // Thu — Legs + Core
    5: 'push_b',                      // Fri — Push B (Pump / Supersets)
    6: saturdaySession(cycleWeek),    // Sat — Swim intervals OR Pull B
  };
  const reentry = reentryWeekMap(now);
  return reentry ? { ...base, ...reentry } : base;
}

/** Static view of the week — Saturday resolved against the live cycle week. */
export const DAY_TO_SESSION: Record<number, string> = getDayToSession();

export const MUSCLE_GROUPS: Record<string, string> = {
  push_a: 'push', push_b: 'push',
  pull_a: 'pull', pull_b: 'pull',
  legs_core: 'legs',
  swim_steady: 'swim', swim_intervals: 'swim',
  cardio_day: 'cardio',
  namban: 'cardio',
  day_7: 'rest',
  road_crossings: 'full_body',
  road_carry: 'full_body',
  road_bar_hunt: 'pull',
  road_fartlek: 'cardio',
  road_ladder: 'cardio',
  road_hiit: 'cardio',
  reentry_a1: 'full_body', reentry_b2: 'full_body', reentry_a3: 'full_body',
  reentry_walk: 'cardio', reentry_run: 'cardio', reentry_travel: 'rest',
  seoul_upper_a: 'push', seoul_upper_b: 'pull', seoul_lower: 'legs',
  seoul_run_long: 'cardio',
};

const SWAP_ORDER: Record<string, string> = {
  push_b: 'pull_b', push_a: 'pull_a',
  pull_b: 'push_b', pull_a: 'push_a',
};

const DAY_NAMES: { day: string; dow: number }[] = [
  { day: 'Mon', dow: 1 }, { day: 'Tue', dow: 2 }, { day: 'Wed', dow: 3 },
  { day: 'Thu', dow: 4 }, { day: 'Fri', dow: 5 }, { day: 'Sat', dow: 6 },
  { day: 'Sun', dow: 0 },
];

export function getWeekSchedule(cycleWeek = getCycleState().week, now = new Date()): { day: string; dow: number; sessionKey: string; label: string }[] {
  const reentry = reentryWeekMap(now);
  if (reentry) {
    return DAY_NAMES.map(d => {
      const sessionKey = reentry[d.dow] ?? 'day_7';
      return { ...d, sessionKey, label: REENTRY_LABELS[sessionKey] ?? sessionKey };
    });
  }
  const sat = saturdaySession(cycleWeek);
  return [
    { day: 'Mon', dow: 1, sessionKey: 'push_a',      label: 'Push A' },
    { day: 'Tue', dow: 2, sessionKey: 'pull_a',      label: 'Pull A' },
    { day: 'Wed', dow: 3, sessionKey: 'swim_steady', label: 'Swim' },
    { day: 'Thu', dow: 4, sessionKey: 'legs_core',   label: 'Legs' },
    { day: 'Fri', dow: 5, sessionKey: 'push_b',      label: 'Push B' },
    { day: 'Sat', dow: 6, sessionKey: sat,           label: sat === 'swim_intervals' ? 'Swim' : 'Pull B' },
    { day: 'Sun', dow: 0, sessionKey: 'day_7',       label: 'Rest' },
  ];
}

export const WEEK_SCHEDULE = getWeekSchedule();

// Rest day DOW — always counts as completed
const REST_DOW = 0;

// ── Session type helpers ───────────────────────────────────────────────────

export function getSessionExercises(session: Session): Exercise[] {
  if (session.exercises) return session.exercises;
  if (session.structure) {
    const coreCircuit = session.structure.block_3_core_circuit;
    if (coreCircuit?.exercises) return coreCircuit.exercises;
    return [];
  }
  return [];
}

export function isCardioDay(session: Session): boolean {
  return !!session.structure && !session.exercises;
}

export function isRestDay(session: Session): boolean {
  return !!session.options && !session.exercises;
}

export function isNambanSession(session: Session): boolean {
  return session?.session_type === 'namban';
}

export function isSwimSession(session: Session): boolean {
  return session?.session_type === 'swim';
}

// ── Smart session selection ────────────────────────────────────────────────

export interface TodaySelection {
  sessionKey: string;
  session: Session;
  wasSwapped: boolean;
  swapReason?: string;
}

export function getTodaySession(
  programme: Programme,
  historyData: HistorySession[],
  now = new Date(),
): TodaySelection {
  const todayDow = now.getDay();
  const dayMap = getDayToSession(getCycleState(now).week, now);
  let sessionKey = dayMap[todayDow];
  let wasSwapped = false;
  let swapReason: string | undefined;

  const recentSession = historyData.length > 0 ? historyData[0] : null;
  const recentType = recentSession?.sessionType?.toLowerCase() || '';
  const recentDateStr = recentSession?.date?.replace(/\s*\(.*\)/, '') || '';
  const recentDate = recentDateStr ? new Date(recentDateStr) : null;
  const hoursSinceLast = recentDate ? (now.getTime() - recentDate.getTime()) / (1000 * 60 * 60) : 999;

  const recentGroup = recentType.includes('push') ? 'push'
    : recentType.includes('pull') ? 'pull'
    : recentType.includes('leg') ? 'legs' : '';

  if (hoursSinceLast < 36 && recentGroup && MUSCLE_GROUPS[sessionKey] === recentGroup) {
    const swapped = SWAP_ORDER[sessionKey];
    if (swapped) {
      swapReason = `${recentGroup} was trained ${Math.round(hoursSinceLast)}h ago — swapped to ${swapped}`;
      sessionKey = swapped;
      wasSwapped = true;
    }
  }

  return {
    sessionKey,
    session: programme.sessions[sessionKey],
    wasSwapped,
    swapReason,
  };
}

// ── Priority-ordered other sessions ────────────────────────────────────────

export function getSessionPriorityOrder(
  programme: Programme,
  todaySessionKey: string,
  now = new Date(),
): [string, Session][] {
  const todayDow = now.getDay();
  const dayMap = getDayToSession(getCycleState(now).week, now);
  const seen = new Set<string>();
  const result: [string, Session][] = [];

  for (let i = 1; i <= 6; i++) {
    const dow = (todayDow + i) % 7;
    const key = dayMap[dow];
    if (key !== todaySessionKey && !seen.has(key) && programme.sessions[key]) {
      seen.add(key);
      result.push([key, programme.sessions[key]]);
    }
  }
  return result;
}

// ── Weekly completion tracking ─────────────────────────────────────────────

export interface WeeklyProgress {
  schedule: ReturnType<typeof getWeekSchedule>;
  completedDows: Set<number>;
  completedCount: number;
  totalScheduled: number;
}

export function getWeeklyProgress(
  historyData: HistorySession[],
  startOfWeekFn: (d: Date, opts: { weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 }) => Date,
  endOfWeekFn: (d: Date, opts: { weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 }) => Date,
  isWithinIntervalFn: (d: Date, interval: { start: Date; end: Date }) => boolean,
  now = new Date(),
): WeeklyProgress {
  const schedule = getWeekSchedule(getCycleState(now).week, now);
  const weekStart = startOfWeekFn(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeekFn(now, { weekStartsOn: 1 });
  const completedDows = new Set<number>();

  for (const sess of historyData) {
    const dateStr = sess.date.split(' ')[0];
    const d = new Date(dateStr + 'T12:00:00');
    if (isWithinIntervalFn(d, { start: weekStart, end: weekEnd })) {
      completedDows.add(d.getDay());
    }
  }

  // Rest days are never "scheduled" work. Normally that is Sunday, and Sunday is
  // free by default. The re-entry block scores differently — ticks out of seven,
  // where a walk clears the day — so during it only an explicit rest session is
  // exempt and nothing is free.
  const blockActive = isReentryBlockActive(now);
  if (!blockActive) completedDows.add(REST_DOW);

  const isRest = (d: { dow: number; sessionKey: string }) =>
    d.sessionKey === 'day_7' || (!blockActive && d.dow === REST_DOW);

  const totalScheduled = schedule.filter(d => !isRest(d)).length;
  const completedCount = schedule.filter(
    d => !isRest(d) && completedDows.has(d.dow)
  ).length;

  return { schedule, completedDows, completedCount, totalScheduled };
}

// ── Daily briefing data ────────────────────────────────────────────────────

export interface DailyBriefing {
  date: string;
  sessionKey: string;
  sessionLabel: string;
  focus: string;
  estimatedMinutes: number;
  wasSwapped: boolean;
  swapReason?: string;
  exercises: {
    name: string;
    sets: number;
    reps: string;
    restSeconds: number;
    notes?: string;
    formCues?: string[];
    rpe?: number;
  }[];
  weekProgress: {
    completed: number;
    total: number;
  };
}

export function buildDailyBriefing(
  programme: Programme,
  historyData: HistorySession[],
  weeklyProgressFns: {
    startOfWeek: (d: Date, opts: { weekStartsOn: number }) => Date;
    endOfWeek: (d: Date, opts: { weekStartsOn: number }) => Date;
    isWithinInterval: (d: Date, interval: { start: Date; end: Date }) => boolean;
  },
  now = new Date(),
): DailyBriefing {
  const { sessionKey, session, wasSwapped, swapReason } = getTodaySession(programme, historyData, now);
  const exercises = getSessionExercises(session);
  const week = getWeeklyProgress(
    historyData,
    weeklyProgressFns.startOfWeek,
    weeklyProgressFns.endOfWeek,
    weeklyProgressFns.isWithinInterval,
    now,
  );

  return {
    date: now.toISOString().split('T')[0],
    sessionKey,
    sessionLabel: session.label || sessionKey,
    focus: session.focus || '',
    estimatedMinutes: session.estimated_duration_minutes || 0,
    wasSwapped,
    swapReason,
    exercises: exercises.map(ex => ({
      name: ex.name,
      sets: ex.sets || 0,
      reps: String(ex.reps || ''),
      restSeconds: ex.rest_seconds || 0,
      notes: ex.notes,
      formCues: ex.form_cues,
      rpe: typeof ex.rpe === 'number' ? ex.rpe : ex.rpe ? Number(ex.rpe) : undefined,
    })),
    weekProgress: {
      completed: week.completedCount,
      total: week.totalScheduled,
    },
  };
}

export function formatBriefingAsText(b: DailyBriefing): string {
  const lines: string[] = [];
  lines.push(`📋 Daily Workout Briefing — ${b.date}`);
  lines.push('');
  lines.push(`Session: ${b.sessionLabel}`);
  if (b.focus) lines.push(`Focus: ${b.focus}`);
  if (b.estimatedMinutes) lines.push(`Duration: ~${b.estimatedMinutes} min`);
  if (b.wasSwapped && b.swapReason) lines.push(`⚠️ ${b.swapReason}`);
  lines.push(`Week progress: ${b.weekProgress.completed}/${b.weekProgress.total} sessions done`);
  lines.push('');

  if (b.exercises.length === 0) {
    lines.push('Rest day — recover, stretch, stay active.');
  } else {
    lines.push('Exercises:');
    b.exercises.forEach((ex, i) => {
      lines.push(`  ${i + 1}. ${ex.name} — ${ex.sets}×${ex.reps} (rest ${ex.restSeconds}s${ex.rpe ? `, RPE ${ex.rpe}` : ''})`);
      if (ex.formCues && ex.formCues.length > 0) {
        lines.push(`     Form: ${ex.formCues.join('; ')}`);
      }
      if (ex.notes) {
        lines.push(`     Note: ${ex.notes}`);
      }
    });
  }

  return lines.join('\n');
}
