/**
 * Rest clock — how long since the last session, per muscle group.
 *
 * Sessions saved by the app carry `finishedAt` (an ISO datetime). Older and
 * seed entries only have a date string, so those fall back to midday on that
 * date — enough for a day-scale rest reading, and flagged as approximate so
 * the UI never shows a fake clock time.
 */

import type { HistorySession } from './data/seedHistory';

export type MuscleGroup = 'push' | 'pull' | 'legs' | 'swim' | 'cardio' | 'other';

export const GROUP_LABELS: Record<MuscleGroup, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  swim: 'Swim',
  cardio: 'Cardio',
  other: 'Other',
};

/** Hours of rest after which a group is considered recovered and due again. */
export const GROUP_TARGET_HOURS: Record<MuscleGroup, number> = {
  push: 48,
  pull: 48,
  legs: 72,
  swim: 24,
  cardio: 24,
  other: 48,
};

export function groupOf(sessionType: string): MuscleGroup {
  const t = (sessionType || '').toLowerCase();
  if (t.includes('swim')) return 'swim';
  if (t.includes('push')) return 'push';
  if (t.includes('pull')) return 'pull';
  if (t.includes('leg') || t.includes('squat')) return 'legs';
  if (t.includes('cardio') || t.includes('run') || t.includes('namban')) return 'cardio';
  return 'other';
}

export interface SessionTime {
  session: HistorySession;
  at: Date;
  /** False when the time was inferred from a date-only entry. */
  exact: boolean;
  group: MuscleGroup;
}

/** Resolves a history entry to a point in time. */
export function timeOf(session: HistorySession): SessionTime | null {
  const group = groupOf(session.sessionType);

  if (session.finishedAt) {
    const at = new Date(session.finishedAt);
    if (!isNaN(at.getTime())) return { session, at, exact: true, group };
  }

  const datePart = (session.date || '').split(' ')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const at = new Date(`${datePart}T12:00:00`);
  if (isNaN(at.getTime())) return null;
  return { session, at, exact: false, group };
}

/** All history entries resolved to times, most recent first. */
export function timeline(history: HistorySession[]): SessionTime[] {
  return history
    .map(timeOf)
    .filter((s): s is SessionTime => s !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function lastSession(history: HistorySession[]): SessionTime | null {
  return timeline(history)[0] ?? null;
}

export function lastSessionOfGroup(history: HistorySession[], group: MuscleGroup): SessionTime | null {
  return timeline(history).find(s => s.group === group) ?? null;
}

export interface GroupRest {
  group: MuscleGroup;
  last: SessionTime | null;
  /** Milliseconds since that session ended. */
  restMs: number | null;
  targetHours: number;
  /** 0 = just trained, 1 = fully rested and due. */
  readiness: number;
  status: 'fresh' | 'recovering' | 'ready' | 'overdue' | 'unknown';
}

export function groupRest(
  history: HistorySession[],
  group: MuscleGroup,
  now = new Date(),
): GroupRest {
  const last = lastSessionOfGroup(history, group);
  const targetHours = GROUP_TARGET_HOURS[group];

  if (!last) {
    return { group, last: null, restMs: null, targetHours, readiness: 1, status: 'unknown' };
  }

  const restMs = Math.max(0, now.getTime() - last.at.getTime());
  const restHours = restMs / 3_600_000;
  const readiness = Math.min(1, restHours / targetHours);

  const status: GroupRest['status'] =
    restHours < targetHours * 0.5 ? 'fresh'
    : restHours < targetHours ? 'recovering'
    : restHours < targetHours * 2.5 ? 'ready'
    : 'overdue';

  return { group, last, restMs, targetHours, readiness, status };
}

export const TRACKED_GROUPS: MuscleGroup[] = ['push', 'pull', 'legs', 'swim'];

export function allGroupRest(history: HistorySession[], now = new Date()): GroupRest[] {
  return TRACKED_GROUPS.map(g => groupRest(history, g, now));
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** "4m" · "1h 12m" · "19h" · "2d 4h" — compact, no seconds past the first hour. */
export function formatRest(ms: number | null): string {
  if (ms === null) return '—';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return 'just now';
  if (totalMin < 60) return `${totalMin}m`;

  const totalHours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (totalHours < 24) return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/** Live-ticking clock face: "19:42:07" for under a day, "2d 04:11" beyond. */
export function formatRestClock(ms: number | null): string {
  if (ms === null) return '--:--:--';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(h)}:${pad(m)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatDuration(sec: number | undefined): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
