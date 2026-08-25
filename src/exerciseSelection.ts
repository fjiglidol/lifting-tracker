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

// ── Temporary plan override: Road Block — Field Games ────────────────────
//
// No gym access while travelling. From ROAD_BLOCK_FROM to ROAD_BLOCK_UNTIL the
// week is served from the outdoor rotation instead of the gym split; after that
// the map reverts on its own with nothing to undo. Details live in
// workouts/2026-08-24-road-block.md and programme.temporary_plan.

export const ROAD_BLOCK_FROM = '2026-08-24';
export const ROAD_BLOCK_UNTIL = '2026-09-06';

const ROAD_DAY_TO_SESSION: Record<number, string> = {
  0: 'day_7',           // Sun — Rest
  1: 'road_crossings',  // Mon — A: Crossings (most active non-gym day)
  2: 'day_7',           // Tue — Rest (swapped off Monday for the road block)
  3: 'road_ladder',     // Wed — C2: The Ladder (Namban replacement)
  4: 'road_bar_hunt',   // Thu — B: The Bar Hunt
  5: 'road_fartlek',    // Fri — C: Fartlek
  6: 'road_carry',      // Sat — D: Carry & Cross
};

// One-off days that override the rotation for a single date. A Grid (HIIT) day
// takes a rest day's slot rather than being added on top, so each entry here
// that adds work is paired with one that gives the rest back. Entries fall out
// of the schedule on their own once their week has passed.

export const ROAD_ONE_OFFS: Record<string, string> = {
  '2026-08-25': 'road_hiit', // Tue — HIIT in place of the rest day
  '2026-08-26': 'day_7',     // Wed — rest moves here; the Ladder slides a week
};

/** Local YYYY-MM-DD — avoids the UTC shift toISOString() would introduce. */
function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isRoadBlockActive(now = new Date()): boolean {
  const today = localISODate(now);
  return today >= ROAD_BLOCK_FROM && today <= ROAD_BLOCK_UNTIL;
}

/** Monday-start week bounds containing `now`, as local YYYY-MM-DD. */
function weekBounds(now: Date): [string, string] {
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return [localISODate(monday), localISODate(sunday)];
}

/** One-off overrides for the week containing `now`, keyed by day of week. */
export function activeOneOffs(now = new Date()): Record<number, string> {
  const [from, to] = weekBounds(now);
  const out: Record<number, string> = {};
  for (const [date, sessionKey] of Object.entries(ROAD_ONE_OFFS)) {
    if (date < from || date > to) continue;
    const [y, m, d] = date.split('-').map(Number);
    out[new Date(y, m - 1, d).getDay()] = sessionKey;
  }
  return out;
}

export function getDayToSession(cycleWeek = getCycleState().week, now = new Date()): Record<number, string> {
  if (isRoadBlockActive(now)) return { ...ROAD_DAY_TO_SESSION, ...activeOneOffs(now) };
  return {
    0: 'day_7',                       // Sun — Full rest
    1: 'push_a',                      // Mon — Push A (Heavy)
    2: 'pull_a',                      // Tue — Pull A (Heavy)
    3: 'swim_steady',                 // Wed — Swim: steady state + core
    4: 'legs_core',                   // Thu — Legs + Core
    5: 'push_b',                      // Fri — Push B (Pump / Supersets)
    6: saturdaySession(cycleWeek),    // Sat — Swim intervals OR Pull B
  };
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
};

const SWAP_ORDER: Record<string, string> = {
  push_b: 'pull_b', push_a: 'pull_a',
  pull_b: 'push_b', pull_a: 'push_a',
};

const ROAD_LABELS: Record<string, string> = {
  road_crossings: 'Crossings',
  road_ladder: 'Ladder',
  road_bar_hunt: 'Bar Hunt',
  road_fartlek: 'Fartlek',
  road_carry: 'Carry',
  road_hiit: 'The Grid',
  day_7: 'Rest',
};

const ROAD_WEEK_SCHEDULE: { day: string; dow: number; sessionKey: string; label: string }[] = [
  { day: 'Mon', dow: 1, sessionKey: 'road_crossings', label: 'Crossings' },
  { day: 'Tue', dow: 2, sessionKey: 'day_7',          label: 'Rest' },
  { day: 'Wed', dow: 3, sessionKey: 'road_ladder',    label: 'Ladder' },
  { day: 'Thu', dow: 4, sessionKey: 'road_bar_hunt',  label: 'Bar Hunt' },
  { day: 'Fri', dow: 5, sessionKey: 'road_fartlek',   label: 'Fartlek' },
  { day: 'Sat', dow: 6, sessionKey: 'road_carry',     label: 'Carry' },
  { day: 'Sun', dow: 0, sessionKey: 'day_7',          label: 'Rest' },
];

export function getWeekSchedule(cycleWeek = getCycleState().week, now = new Date()): { day: string; dow: number; sessionKey: string; label: string }[] {
  if (isRoadBlockActive(now)) {
    const oneOffs = activeOneOffs(now);
    return ROAD_WEEK_SCHEDULE.map(d => {
      const override = oneOffs[d.dow];
      if (!override) return { ...d };
      return { ...d, sessionKey: override, label: ROAD_LABELS[override] ?? d.label };
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

  completedDows.add(REST_DOW);

  // Rest days are never "scheduled" work. Normally that is just Sunday; during
  // the road block Monday is a rest day too, so key off the session rather than
  // the day number.
  const isRest = (d: { dow: number; sessionKey: string }) =>
    d.sessionKey === 'day_7' || d.dow === REST_DOW;

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
