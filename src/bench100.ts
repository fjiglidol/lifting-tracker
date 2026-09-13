// ── Bench 100 Block — 2026-09-14 → 2026-12-13 ──────────────────────────────
//
// Thirteen weeks, three targets: a 100 kg bench single, a 120 kg hip thrust,
// and a 1500 m under the week-2 baseline. Full reasoning lives in
// workouts/2026-09-14-bench-100-13week.md.
//
// Loads are written in advance, week by week, rather than resolved by the
// coaching engine on the day. A strength block's numbers are a plan, not a
// reaction — and weeks 5+ get rewritten anyway when the week-4 top single
// resets the training max.
//
// The block window is a date range, so this expires on its own and the app
// falls back to the standard split with nothing to undo.

import type { Exercise, Session } from './types';

export const BLOCK_FROM = '2026-09-14';
export const BLOCK_UNTIL = '2026-12-13';

/** Local YYYY-MM-DD — avoids the UTC shift toISOString() would introduce. */
export function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isBlockActive(now = new Date()): boolean {
  const today = localISODate(now);
  return today >= BLOCK_FROM && today <= BLOCK_UNTIL;
}

/** 1-13 inside the block, null outside it. Week 1 starts Mon 2026-09-14. */
export function blockWeek(now = new Date()): number | null {
  if (!isBlockActive(now)) return null;
  const [y, m, d] = BLOCK_FROM.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = Math.floor((today.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  return Math.min(Math.max(week, 1), 13);
}

export type BlockPhase = 'reacquisition' | 'strength' | 'peak' | 'deload' | 'attempt';

export function blockPhase(week: number): BlockPhase {
  if (week <= 4) return 'reacquisition';
  if (week <= 8) return 'strength';
  if (week <= 11) return 'peak';
  if (week === 12) return 'deload';
  return 'attempt';
}

export const PHASE_LABEL: Record<BlockPhase, string> = {
  reacquisition: 'Block 1 · Re-acquisition',
  strength: 'Block 2 · Strength',
  peak: 'Block 3 · Peak',
  deload: 'Block 3 · Deload',
  attempt: 'Week 13 · The attempts',
};

// ── The week ───────────────────────────────────────────────────────────────
//
// Five training days is the ceiling, not the expectation. PRIORITY is what the
// week sheds from when it shrinks: A > B > T2 > C > T1. Floor is A + B.

export const DOW_TO_SESSION: Record<number, string> = {
  1: 'day_7',              // Mon — REST
  2: 'b100_bench_heavy',   // Tue — A · never cut
  3: 'b100_easy_run',      // Wed — T1
  4: 'b100_legs_glutes',   // Thu — B
  5: 'day_7',              // Fri — REST / walk
  6: 'b100_bench_volume',  // Sat — C
  0: 'b100_track',         // Sun — T2
};

export const DAY_LABELS: Record<string, string> = {
  b100_bench_heavy: 'Bench A',
  b100_legs_glutes: 'Legs & Glutes',
  b100_bench_volume: 'Bench C',
  b100_easy_run: 'Easy Run',
  b100_track: 'Track',
  day_7: 'Rest',
};

/** Lower number = survives longer when the week collapses. */
export const PRIORITY: Record<string, number> = {
  b100_bench_heavy: 1,
  b100_legs_glutes: 2,
  b100_track: 3,
  b100_bench_volume: 4,
  b100_easy_run: 5,
};

export const PRIORITY_NOTE: Record<string, string> = {
  b100_bench_heavy: 'Priority 1 — never cut. On a bad day this becomes the top sets only, 15 minutes, no accessories.',
  b100_legs_glutes: 'Priority 2 — the glute build. Hip thrust is the lift that matters here; everything after it is optional.',
  b100_track: 'Priority 3 — the cheapest session in the block and the one that feels best. Full recovery between reps, so it costs almost nothing.',
  b100_bench_volume: 'Priority 4 — 30 minutes. Skippable, but it is short, which is rather the point.',
  b100_easy_run: 'Priority 5 — a 25-minute walk replaces this entirely and still counts.',
};

// ── Per-week prescriptions ─────────────────────────────────────────────────
//
// One entry per week, index 0 = week 1. `null` means the exercise is not in
// that week's session at all.

export interface WeekSpec {
  sets: number;
  reps: string;
  load?: number;      // kg on the bar
  rpe?: string;
  note?: string;
}

type Plan = Record<string, (WeekSpec | null)[]>;

const w = (sets: number, reps: string, load?: number, rpe?: string, note?: string): WeekSpec =>
  ({ sets, reps, load, rpe, note });

const BENCH_TEST = (expect: string): WeekSpec => w(
  1, 'ramp to one top single', undefined, '8',
  `TEST WEEK — no working sets. Rungs: 40×5, 55×3, 65×2, then singles as they feel. Stop at RPE 8: a rep left in the tank, no grinding, no spotter-assisted reps. Expect ${expect}. Whatever this single is becomes the training max the next block is written against.`,
);

export const PLAN: Record<string, Plan> = {
  b100_bench_heavy: {
    'Barbell Bench Press': [
      w(4, '6', 57.5, '6', 'Week 1 will feel insultingly light. That is the design — your last four months of bench topped out at 56 kg and this is pattern work, not a test.'),
      w(4, '6', 60, '6'),
      w(4, '6', 62.5, '7'),
      BENCH_TEST('87.5–92.5 kg'),
      w(5, '3', 72.5, '7', 'Reps drop, weight climbs. This block is where most of the 20 kg gets made.'),
      w(5, '3', 75, '7'),
      w(5, '3', 77.5, '8'),
      BENCH_TEST('95–97.5 kg'),
      w(3, '2', 85, '8', 'Peak block. You should feel fresher week by week, not more beaten up — if you do not, pull a session rather than adding one.'),
      w(3, '2', 87.5, '8'),
      w(3, '1', 92.5, '9', 'Heaviest single before the attempt. If this moves clean, 100 is there.'),
      w(3, '3', 70, '5', 'DELOAD. Halve everything. Deload means deload — nothing heavy after today.'),
      w(1, 'ramp to 100 kg', 100, '10', 'THE ATTEMPT. 40×5 · 60×3 · 75×2 · 85×1 · 92.5×1 · 97.5×1 · 100. Three to four minutes between singles. HAVE A SPOTTER — no spotter, no attempt, reschedule. Read 92.5: clean and fast → go on. Grinds → take 97.5 and stop, that is still a complete block. Two attempts at 100, maximum. Film the top two singles.'),
    ],
    'Paused Bench Press': [
      w(2, '5', 46, '6', 'Three full seconds still on the chest. This is where the bottom of your bench went — it rebuilds the position you lost.'),
      w(2, '5', 48, '6'),
      w(2, '5', 50, '7'),
      null,
      w(2, '6', 62.5, '7', 'Back-off sets now, not paused — volume after the heavy triples.'),
      w(2, '6', 65, '7'),
      w(2, '6', 65, '7'),
      null,
      w(2, '5', 75, '7'),
      w(2, '4', 77.5, '7'),
      w(2, '3', 80, '7'),
      null,
      null,
    ],
    'Barbell Row': [
      w(4, '8', 55, '7', 'You press off your back, not off the bench. Roughly your bench working weight.'),
      w(4, '8', 57.5, '7'), w(4, '8', 60, '7'), w(4, '8', 60, '7'),
      w(4, '6', 65, '7'), w(4, '6', 67.5, '7'), w(4, '6', 70, '8'), w(4, '6', 72.5, '8'),
      w(3, '6', 75, '7'), w(3, '6', 75, '7'), w(3, '6', 77.5, '7'), w(3, '6', 50, '5'),
      null,
    ],
    'Assisted Pull-Up': [
      ...Array.from({ length: 4 }, () => w(4, '5', undefined, '7', 'Reduce the assistance, not the reps. Target for week 13 is five unassisted — the structural gap your file has flagged since March.')),
      ...Array.from({ length: 4 }, () => w(4, '5', undefined, '7')),
      ...Array.from({ length: 3 }, () => w(3, '5', undefined, '7')),
      w(2, '5', undefined, '5'),
      null,
    ],
    'Face Pull': [
      ...Array.from({ length: 12 }, () => w(3, '15', undefined, '6', 'Light, every single session, no exceptions. Hundred-odd sets across the block is the cheapest shoulder insurance you will ever buy at this bench weight.')),
      null,
    ],
  },

  b100_legs_glutes: {
    'Barbell Hip Thrust': [
      w(4, '8', 60, '7', 'The primary lift of this day and the only exercise that loads the glute hard at full hip extension — which is exactly where squats give it nothing. Pause one second at the top, ribs down, chin tucked.'),
      w(4, '8', 70, '7'), w(4, '8', 80, '7'), w(4, '8', 85, '8'),
      w(4, '8', 90, '7'), w(4, '8', 95, '8'), w(4, '8', 100, '8'), w(4, '8', 105, '8'),
      w(4, '8', 110, '8'), w(4, '8', 115, '8'),
      w(4, '8', 120, '8', 'The glute target. Note that this keeps climbing while the bench deloads — hip thrust costs the nervous system almost nothing and the goal here is size, not a max.'),
      w(4, '8', 80, '5'),
      w(3, '8', 90, '6'),
    ],
    'Barbell Back Squat': [
      w(4, '6', 60, '6', 'High bar, BELOW PARALLEL. A squat is only a glute exercise below parallel — quarter squats build quads and ego.'),
      w(4, '6', 65, '7'), w(4, '6', 67.5, '7'), w(4, '6', 70, '7'),
      w(4, '5', 75, '7'), w(4, '5', 77.5, '7'), w(4, '5', 80, '8'), w(4, '5', 82.5, '8'),
      w(3, '5', 85, '8'), w(3, '5', 87.5, '8'), w(3, '5', 87.5, '8'), w(3, '5', 65, '5'),
      null,
    ],
    'Romanian Deadlift': [
      w(3, '8', 50, '7'), w(3, '8', 55, '7'), w(3, '8', 57.5, '7'), w(3, '8', 60, '7'),
      w(3, '6', 65, '7'), w(3, '6', 67.5, '7'), w(3, '6', 70, '8'), w(3, '6', 72.5, '8'),
      w(3, '6', 75, '8'), w(3, '6', 77.5, '8'), w(3, '6', 80, '8'), w(3, '6', 60, '5'),
      w(3, '6', 65, '6'),
    ],
    'Bulgarian Split Squat': [
      ...Array.from({ length: 4 }, () => w(3, '10 per leg', undefined, '7', 'LONG stride, torso leaned forward over the front leg. Upright = quads. Forward = glutes. Start bodyweight if week 1 is ugly — it usually is.')),
      ...Array.from({ length: 4 }, () => w(3, '8 per leg', undefined, '8', 'Add dumbbells, keep the lean.')),
      ...Array.from({ length: 3 }, () => w(3, '8 per leg', undefined, '8')),
      w(2, '8 per leg', undefined, '5'),
      null,
    ],
    'Cable Hip Abduction': [
      ...Array.from({ length: 11 }, () => w(3, '20', undefined, '7', 'Gluteus medius — the upper-outer shelf almost nobody trains and that does most of the visual work. Go light enough to actually feel it burn.')),
      w(2, '20', undefined, '5'),
      null,
    ],
    'Standing Calf Raise': [
      ...Array.from({ length: 8 }, () => w(4, '15', undefined, '7', 'Named weak point, and your shin-splint insurance now that there is running in the week. Full stretch at the bottom, pause at the top.')),
      ...Array.from({ length: 4 }, () => w(3, '15', undefined, '7')),
      null,
    ],
  },

  b100_bench_volume: {
    'Barbell Bench Press': [
      w(5, '5', 50, '6', 'EXPLOSIVE. Ninety seconds rest. This is bar speed work, not a second heavy day — if it feels hard you are going too heavy.'),
      w(5, '5', 52.5, '6'), w(5, '5', 55, '6'), w(5, '5', 57.5, '7'),
      w(4, '5', 65, '7'), w(4, '5', 67.5, '7'), w(4, '5', 70, '7'), w(4, '5', 70, '7'),
      w(4, '4', 75, '7'), w(4, '4', 77.5, '7'), w(4, '4', 80, '7'),
      null,
      null,
    ],
    'Paused Bench Press': [
      null, null, null, null,
      w(3, '3', 60, '7', 'Three seconds on the chest.'), w(3, '3', 62.5, '7'), w(3, '3', 65, '7'), w(3, '3', 65, '7'),
      null, null, null, null, null,
    ],
    'Barbell Overhead Press': [
      w(4, '6', 30, '7', 'The widest gap in your file — machine OHP at 8–12 kg against a 90 kg bench. A weak press is a poor shoulder platform, and a poor platform limits how hard you are willing to push near max. Highest-leverage accessory in the block.'),
      w(4, '6', 32.5, '7'), w(4, '6', 35, '8'), w(4, '6', 35, '8'),
      w(4, '5', 37.5, '7'), w(4, '5', 40, '8'), w(4, '5', 40, '8'), w(4, '5', 42.5, '8'),
      w(3, '5', 45, '8'), w(3, '5', 45, '8'), w(3, '5', 47.5, '8'), w(3, '5', 35, '5'),
      null,
    ],
    'Close-Grip Bench Press': [
      w(3, '8', 40, '7', 'Lockout. Benches in the 90–100 range fail four to six inches off the chest, and that is triceps — trainable in eight weeks.'),
      w(3, '8', 42.5, '7'), w(3, '8', 45, '7'), w(3, '8', 45, '7'),
      w(3, '6', 55, '8'), w(3, '6', 57.5, '8'), w(3, '6', 60, '8'), w(3, '6', 62.5, '8'),
      w(3, '6', 62.5, '8'), w(3, '6', 65, '8'), w(3, '6', 65, '8'),
      null, null,
    ],
    'Incline Dumbbell Press': [
      ...Array.from({ length: 4 }, () => w(3, '10', 30, '7', 'Per hand. Add 2 kg when all three sets clear — you were at 40 kg/hand in March, so this comes back fast.')),
      ...Array.from({ length: 4 }, () => w(3, '10', 32.5, '7')),
      ...Array.from({ length: 3 }, () => w(3, '10', 35, '7')),
      null, null,
    ],
    'Dips': [
      null, null, null, null,
      ...Array.from({ length: 4 }, () => w(3, 'AMRAP', undefined, '8', 'Assisted if needed. Lean forward for chest, upright for triceps — either is fine here.')),
      null, null, null, null, null,
    ],
    'Assisted Pull-Up': [
      ...Array.from({ length: 4 }, () => w(3, '5', undefined, '7')),
      null, null, null, null, null, null, null, null, null,
    ],
  },
};

// ── Running ────────────────────────────────────────────────────────────────

export const RUN_PLAN: { t1: string; t2: string; t2label: string }[] = [
  { t1: 'Easy 25 min, flat, conversational', t2: '6 × 200 m · walk 200 m back', t2label: '6 × 200 m' },
  { t1: 'Easy 25 min, flat, conversational', t2: '1500 m TIME TRIAL — the baseline every later number is measured against. Full 15 min warm-up including 4 × 100 m strides. Go out ON PACE, not on feeling.', t2label: '1500 m TT' },
  { t1: 'Easy 30 min', t2: '8 × 200 m · walk 200 m back', t2label: '8 × 200 m' },
  { t1: 'Easy 30 min', t2: '5 × 300 m · 90 s standing rest', t2label: '5 × 300 m' },
  { t1: 'Easy 30 min with 10 min at tempo (RPE 7, comfortably hard)', t2: '10 × 200 m · walk 200 m back', t2label: '10 × 200 m' },
  { t1: 'Easy 30 min with 10 min at tempo', t2: '6 × 300 m · 90 s', t2label: '6 × 300 m' },
  { t1: '35 min with 2 × 8 min at tempo', t2: '4 × 400 m · 3 min', t2label: '4 × 400 m' },
  { t1: 'Easy 25 min — nothing hard, time trial this week', t2: '1500 m TIME TRIAL — expect 20–40 s off the week 2 number.', t2label: '1500 m TT' },
  { t1: '35 min with 2 × 8 min at tempo', t2: '5 × 400 m · 3 min', t2label: '5 × 400 m' },
  { t1: 'Easy 40 min', t2: '3 × 600 m · 4 min', t2label: '3 × 600 m' },
  { t1: '35 min with 10 min at tempo', t2: '6 × 400 m · 2.5 min', t2label: '6 × 400 m' },
  { t1: 'Easy 20 min', t2: 'Easy 20 min — bench deload week, nothing hard', t2label: 'Easy 20 min' },
  { t1: 'Easy 20 min', t2: '1500 m TIME TRIAL — the second number of the block. Split it even and pass people on the last lap.', t2label: '1500 m TT' },
];

// ── Applying a week to a session ───────────────────────────────────────────

/**
 * Rewrite a session's exercises with the prescriptions for `week`. Exercises
 * with no spec for that week are dropped, so a session shrinks through the
 * peak block rather than carrying dead sets.
 */
export function applyWeek(sessionKey: string, session: Session, week: number): Session {
  const idx = week - 1;

  if (sessionKey === 'b100_easy_run' || sessionKey === 'b100_track') {
    const run = RUN_PLAN[idx];
    if (!run) return session;
    const text = sessionKey === 'b100_easy_run' ? run.t1 : run.t2;
    return {
      ...session,
      label: `${session.label} — ${sessionKey === 'b100_track' ? run.t2label : 'Easy'}`,
      notes: `${text}\n\n${session.notes ?? ''}`.trim(),
    };
  }

  const plan = PLAN[sessionKey];
  if (!plan) return session;

  const exercises: Exercise[] = [];
  for (const ex of session.exercises ?? []) {
    const spec = plan[ex.name]?.[idx];
    if (spec === undefined) { exercises.push(ex); continue; }  // not planned — leave alone
    if (spec === null) continue;                                // planned out of this week
    exercises.push({
      ...ex,
      sets: spec.sets,
      reps: spec.load && !/kg/.test(spec.reps) ? `${spec.reps} @ ${spec.load} kg` : spec.reps,
      rpe: spec.rpe ?? ex.rpe,
      notes: spec.note ? `${spec.note}${ex.notes ? `\n\n${ex.notes}` : ''}` : ex.notes,
    });
  }
  return { ...session, exercises };
}
