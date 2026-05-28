/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import DesktopApp from './desktop/DesktopApp';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Timer,
  CheckCircle2,
  X,
  Play,
  Pause,
  RotateCcw,
  Dumbbell,
  ArrowRight,
  History,
  Calendar,
  Share2,
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  Moon,
  CloudUpload,
  Shuffle
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, differenceInDays, parseISO, startOfWeek, endOfWeek, isWithinInterval, addDays } from 'date-fns';
import programmeData from './data/programme.json';
import { seedHistory, mergeHistory, type HistorySession } from './data/seedHistory';
import {
  DAY_TO_SESSION,
  MUSCLE_GROUPS,
  WEEK_SCHEDULE,
  getSessionExercises,
  isCardioDay,
  isRestDay,
  getTodaySession,
  getSessionPriorityOrder,
  getWeeklyProgress,
} from './exerciseSelection';
import { Programme, Session, Exercise, SetEntry, SessionProgress } from './types';
import {
  evaluateSession,
  getRecommendedWeights,
  getPerSetWeights,
  computeFatigueScore,
  loadCoachingState,
  saveCoachingState,
  computePRs,
  computeMilestoneAlert,
  normaliseExerciseName,
  PostSessionFeedback,
  SessionEvaluation,
  CoachingState,
  PRRecord,
  MilestoneAlert,
} from './coachingEngine';
import {
  exerciseRegistry,
  getSynergistSuggestion,
  type SynergistSuggestion,
} from './data/exerciseRegistry';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const programme = programmeData as Programme;

/** Scrolling text — only animates when the text overflows its container */
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const check = () => {
      if (containerRef.current && textRef.current) {
        const diff = textRef.current.scrollWidth - containerRef.current.clientWidth;
        setOverflow(diff > 2 ? diff : 0);
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [text]);

  // Speed: ~40px per second for consistent readability
  const duration = overflow > 0 ? overflow / 40 : 0;

  return (
    <div ref={containerRef} className="overflow-hidden min-w-0">
      <motion.span
        ref={textRef}
        className={cn("inline-block whitespace-nowrap", className)}
        animate={overflow > 0 ? {
          x: [0, 0, -overflow, -overflow, 0],
        } : { x: 0 }}
        transition={overflow > 0 ? {
          x: {
            duration: duration + 3,
            times: [0, 0.15, 0.5, 0.85, 1],
            repeat: Infinity,
            ease: "linear",
          }
        } : undefined}
      >
        {text}
      </motion.span>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<'select' | 'workout' | 'feedback' | 'report'>('select');
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null);
  const [setData, setSetData] = useState<{ [exIdx: number]: SetEntry[] }>({});
  const [skipped, setSkipped] = useState<{ [exIdx: number]: boolean }>({});
  const [elapsed, setElapsed] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [restTimer, setRestTimer] = useState<{ active: boolean; remaining: number; total: number; exName: string }>({
    active: false,
    remaining: 0,
    total: 0,
    exName: ''
  });

  const [exerciseRpe, setExerciseRpe] = useState<{ [exIdx: number]: number }>({});
  const [historyData, setHistoryData] = useState<HistorySession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Coaching state
  const [coachingState, setCoachingState] = useState<CoachingState>(() => loadCoachingState());
  const [pendingFeedback, setPendingFeedback] = useState<PostSessionFeedback | null>(null);
  const [currentEvaluation, setCurrentEvaluation] = useState<SessionEvaluation | null>(null);
  const [recommendedWeights, setRecommendedWeights] = useState<Record<string, (number | null)[]>>({});

  // Synergist suggestion state
  const [synergistSuggestion, setSynergistSuggestion] = useState<SynergistSuggestion | null>(null);
  const [suggestionHidden, setSuggestionHidden] = useState(false);

  // PR detection state
  const [prMap, setPrMap] = useState<Record<string, PRRecord>>({});
  const [newPRBanner, setNewPRBanner] = useState<{ exercise: string; weight: number; oldPR: number } | null>(null);

  // Last-session data per exercise (keyed by exercise index)
  const [lastSessionByEx, setLastSessionByEx] = useState<Record<number, { weight: number; reps: number } | null>>({});

  // Sparkline data per exercise (keyed by exercise index)
  const [sparklinesByEx, setSparklinesByEx] = useState<Record<number, number[]>>({});

  // Milestone alert
  const [milestoneAlert, setMilestoneAlert] = useState<MilestoneAlert | null>(null);
  const [milestoneAlertDismissed, setMilestoneAlertDismissed] = useState(false);

  // Undo quit — restorable session backup
  const [undoSession, setUndoSession] = useState<SessionProgress | null>(() => {
    try {
      const saved = localStorage.getItem('liftoff_session_undo');
      if (saved) return JSON.parse(saved) as SessionProgress;
    } catch {}
    return null;
  });

  // Rest timer coaching cue
  const [showCoachingCue, setShowCoachingCue] = useState(false);
  const [coachingCueText, setCoachingCueText] = useState('');

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const restTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Keep a ref of latest session state so background-save handlers avoid stale closures
  const progressRef = useRef({ currentSessionKey, setData, skipped, elapsed });
  useEffect(() => {
    progressRef.current = { currentSessionKey, setData, skipped, elapsed };
  }, [currentSessionKey, setData, skipped, elapsed]);

  // Save session on background/close — prevents iOS kill data loss
  useEffect(() => {
    const emergencySave = () => {
      const { currentSessionKey: key, setData: data, skipped: skip, elapsed: time } = progressRef.current;
      if (!key) return;
      const progress = { sessionKey: key, setData: data, skipped: skip, elapsed: time, savedAt: Date.now() };
      localStorage.setItem('liftoff_session', JSON.stringify(progress));
    };
    const onVisChange = () => { if (document.visibilityState === 'hidden') emergencySave(); };
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('pagehide', emergencySave);
    window.addEventListener('beforeunload', emergencySave);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('pagehide', emergencySave);
      window.removeEventListener('beforeunload', emergencySave);
    };
  }, []);

  // Manual log form state
  const [logFormOpen, setLogFormOpen] = useState(false);
  const [logFormDate, setLogFormDate] = useState('');
  const [logFormSessionType, setLogFormSessionType] = useState('Push A (Heavy)');
  const [logFormText, setLogFormText] = useState('');
  const [logFormError, setLogFormError] = useState('');

  // Load history on mount — try API first, fall back to localStorage + seed
  useEffect(() => {
    fetch('/api/history')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => setHistoryData(d.sessions || []))
      .catch(() => {
        const stored = localStorage.getItem('gsb_history');
        let local: HistorySession[] = [];
        if (stored) {
          try { local = JSON.parse(stored); } catch {}
        }
        setHistoryData(mergeHistory(local));
      });
  }, [screen]);

  // Load saved session on mount
  useEffect(() => {
    const saved = localStorage.getItem('liftoff_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SessionProgress;
        // Optional: Check if saved session is recent (e.g., within 12 hours)
        if (Date.now() - parsed.savedAt < 12 * 60 * 60 * 1000) {
          // We could show a "Resume" prompt here, but for now let's just keep it in memory
          // and only resume if the user clicks a specific button.
        }
      } catch (e) {
        console.error('Failed to parse saved session', e);
      }
    }
  }, []);

  // Session Timer Logic
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning]);

  // Rest Timer Logic
  useEffect(() => {
    if (restTimer.active && restTimer.remaining > 0) {
      restTimerRef.current = setInterval(() => {
        setRestTimer(prev => ({ ...prev, remaining: prev.remaining - 1 }));
      }, 1000);
    } else if (restTimer.remaining <= 0 && restTimer.active) {
      if (restTimerRef.current) clearInterval(restTimerRef.current);
      // Vibrate if supported
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      // Show coaching cue for 3s then dismiss
      setShowCoachingCue(true);
      setTimeout(() => {
        setShowCoachingCue(false);
        setRestTimer(prev => ({ ...prev, active: false }));
      }, 3000);
    }
    return () => {
      if (restTimerRef.current) clearInterval(restTimerRef.current);
    };
  }, [restTimer.active, restTimer.remaining]);

  // Generate synergist suggestion + coaching cue whenever rest timer starts
  useEffect(() => {
    if (restTimer.active && currentSessionKey) {
      const suggestion = getSynergistSuggestion(
        currentSessionKey,
        historyData,
        exerciseRegistry
      );
      setSynergistSuggestion(suggestion);
      setSuggestionHidden(false);
      setShowCoachingCue(false);

      // Pre-compute coaching cue for when timer hits 0
      const exName = restTimer.exName;
      const lastData = Object.values(lastSessionByEx).find((_, i) => {
        // find by matching exName to current exercises
        if (!currentSessionKey) return false;
        const exercises = getSessionExercises(programme.sessions[currentSessionKey]);
        return exercises[i]?.name === exName || normaliseExerciseName(exercises[i]?.name ?? '') === normaliseExerciseName(exName);
      });
      // Look up from lastSessionByEx by exercise name
      if (currentSessionKey) {
        const exercises = getSessionExercises(programme.sessions[currentSessionKey]);
        const exIdx = exercises.findIndex(e =>
          normaliseExerciseName(e.name) === normaliseExerciseName(exName)
        );
        const last = exIdx >= 0 ? lastSessionByEx[exIdx] : null;
        if (last && last.weight > 0) {
          setCoachingCueText(`Last time: ${last.weight}kg × ${last.reps}. Go.`);
        } else {
          setCoachingCueText('Focus on form. Controlled reps.');
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restTimer.active]);

  const saveProgress = (key: string, data: typeof setData, skip: typeof skipped, time: number) => {
    const progress: SessionProgress = {
      sessionKey: key,
      setData: data,
      skipped: skip,
      elapsed: time,
      savedAt: Date.now()
    };
    localStorage.setItem('liftoff_session', JSON.stringify(progress));
  };

  const startSession = (key: string, resume = false) => {
    const session = programme.sessions[key];
    if (!session) return;

    if (resume) {
      const saved = localStorage.getItem('liftoff_session');
      if (saved) {
        const parsed = JSON.parse(saved) as SessionProgress;
        setCurrentSessionKey(parsed.sessionKey);
        setSetData(parsed.setData);
        setSkipped(parsed.skipped);
        setElapsed(parsed.elapsed);
      }
    } else {
      setCurrentSessionKey(key);
      const initialSetData: { [idx: number]: SetEntry[] } = {};
      const initialRpe: { [idx: number]: number } = {};
      const exercises = getSessionExercises(session);
      exercises.forEach((ex, idx) => {
        initialSetData[idx] = Array.from({ length: ex.sets || 1 }, () => ({
          weight: '',
          reps: '',
          note: '',
          logged: false
        }));
        if (ex.type === 'weight') {
          initialRpe[idx] = 7; // default RPE
        }
      });
      setSetData(initialSetData);
      setExerciseRpe(initialRpe);
      setSkipped({});
      setElapsed(0);

      // Compute per-set ghost weights for all weighted exercises
      const ghosts: Record<string, (number | null)[]> = {};
      const coaching = loadCoachingState();
      exercises.forEach(ex => {
        if (ex.type === 'weight') {
          const topWeight = getRecommendedWeights(
            ex.name, ex, historyData, coaching.acceptedAdjustments
          );
          const numSets = ex.sets || 3;
          if (topWeight !== null && topWeight > 0) {
            ghosts[ex.name] = getPerSetWeights(topWeight, numSets, key, ex);
          } else {
            ghosts[ex.name] = Array(numSets).fill(null);
          }
        }
      });
      setRecommendedWeights(ghosts);

      // Compute PRs
      const prs = computePRs(historyData);
      setPrMap(prs);

      // Compute last-session data per exercise (for beat-last-session + sparklines)
      const lastByEx: Record<number, { weight: number; reps: number } | null> = {};
      const sparklines: Record<number, number[]> = {};
      exercises.forEach((ex, idx) => {
        if (ex.type !== 'weight') { lastByEx[idx] = null; return; }
        const canonical = normaliseExerciseName(ex.name);
        // Find all history entries for this exercise, sorted oldest→newest
        const entries: { weight: number; reps: number; date: string }[] = [];
        for (const sess of [...historyData].reverse()) {
          for (const he of sess.exercises) {
            if (normaliseExerciseName(he.exercise) !== canonical) continue;
            const weights = he.weight.split('/').map(w => parseFloat(w)).filter(w => !isNaN(w) && w > 0);
            const repsArr = he.reps.split('/').map(r => parseInt(r)).filter(r => !isNaN(r) && r > 0);
            if (weights.length === 0) continue;
            const topWeight = Math.max(...weights);
            const topIdx = weights.lastIndexOf(topWeight);
            const topReps = repsArr[topIdx] ?? (repsArr.length > 0 ? Math.max(...repsArr) : 0);
            entries.push({ weight: topWeight, reps: topReps, date: sess.date });
          }
        }
        // Most recent entry = last session
        const last = entries.length > 0 ? entries[entries.length - 1] : null;
        lastByEx[idx] = last ? { weight: last.weight, reps: last.reps } : null;

        // Sparkline: last 6 top-set weights
        const allWeights = entries.map(e => e.weight);
        sparklines[idx] = allWeights.slice(-6);
      });
      setLastSessionByEx(lastByEx);
      setSparklinesByEx(sparklines);

      // Compute milestone alert
      const alert = computeMilestoneAlert(historyData);
      setMilestoneAlert(alert);
      setMilestoneAlertDismissed(false);
    }

    setIsTimerRunning(true);
    setScreen('workout');
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleFinish = () => {
    setIsTimerRunning(false);
    localStorage.removeItem('liftoff_session');
    setScreen('feedback');
  };

  const handleFeedbackSubmit = async (feedback: PostSessionFeedback | null) => {
    // Build updated feedback history
    const updatedFeedbackHistory = feedback
      ? [...coachingState.feedbackHistory, feedback]
      : coachingState.feedbackHistory;

    // Run coaching evaluation
    if (currentSessionKey) {
      try {
        const evaluation = evaluateSession(
          currentSessionKey,
          setData,
          skipped,
          historyData,
          programme,
          updatedFeedbackHistory,
          coachingState.acceptedAdjustments
        );
        setCurrentEvaluation(evaluation);

        // Update coaching state
        const newState: CoachingState = {
          ...coachingState,
          feedbackHistory: updatedFeedbackHistory,
          evaluations: [...coachingState.evaluations, evaluation],
          athleteState: {
            ...coachingState.athleteState,
            fatigue_7day: ['fresh', 'normal', 'accumulating', 'deload_recommended'].indexOf(evaluation.fatigue_level)
          }
        };
        setCoachingState(newState);
        saveCoachingState(newState);
      } catch (e) {
        console.error('Coaching evaluation failed:', e);
        setCurrentEvaluation(null);
      }
    }

    setPendingFeedback(feedback);

    // Always go to report (handles both feedback and skip paths)
    await saveToICloud();
    setScreen('report');
  };

  const handleReportDone = (acceptedWeights: Record<string, number>) => {
    // Merge accepted weights into coaching state
    const newAccepted = { ...coachingState.acceptedAdjustments, ...acceptedWeights };
    const newState: CoachingState = {
      ...coachingState,
      acceptedAdjustments: newAccepted
    };
    setCoachingState(newState);
    saveCoachingState(newState);
    setScreen('select');
  };

  const generateCSV = () => {
    if (!currentSessionKey) return '';
    const session = programme.sessions[currentSessionKey];
    const header = 'Date,Session_Type,Exercise,Weight_kg,Sets,Reps,RPE,Notes';
    const dateStr = format(new Date(), 'yyyy-MM-dd (EEE)');
    const sessionType = session.label.split(' — ')[1] || session.label;

    const exercises = getSessionExercises(session);
    const lines = [header];
    exercises.forEach((ex, idx) => {
      if (skipped[idx]) return;
      const sets = setData[idx] || [];
      const loggedSets = sets.filter(s => s.weight !== '' || s.reps !== '');
      if (loggedSets.length === 0) return;

      const weights = loggedSets.map(s => s.weight || '0').join('/');
      const reps = loggedSets.map(s => s.reps || (ex.duration_seconds ? `${ex.duration_seconds}s` : '0')).join('/');
      const rpeVal = ex.type === 'weight' ? (exerciseRpe[idx] ?? 7) : '';
      const notes = loggedSets.map(s => s.note).filter(Boolean).join('; ');

      lines.push(`"${dateStr}","${sessionType}","${ex.name}","${weights}",${loggedSets.length},"${reps}",${rpeVal},"${notes}"`);
    });

    return lines.join('\n');
  };

  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [iCloudStatus, setICloudStatus] = useState<'idle' | 'saving' | 'saved' | 'share'>('idle');

  const saveToICloud = async () => {
    if (!currentSessionKey) return;

    // Always save to localStorage regardless of whether sets have data
    const session = programme.sessions[currentSessionKey];
    const sessionType = session.label.split(' — ')[1] || session.label;
    const dateStr = format(new Date(), 'yyyy-MM-dd (EEE)');
    const exercises = getSessionExercises(session);
    const loggedExercises = exercises
      .map((ex, idx) => {
        if (skipped[idx]) return null;
        const sets = setData[idx] || [];
        const logged = sets.filter(s => s.weight !== '' || s.reps !== '');
        if (logged.length === 0) return null;
        return {
          exercise: ex.name,
          weight: logged.map(s => s.weight || '0').join('/'),
          sets: String(logged.length),
          reps: logged.map(s => s.reps || '0').join('/'),
          notes: logged.map(s => s.note).filter(Boolean).join('; ')
        };
      })
      .filter(Boolean) as { exercise: string; weight: string; sets: string; reps: string; notes: string }[];

    const newSession: HistorySession = { date: dateStr, sessionType, exercises: loggedExercises };
    const stored = localStorage.getItem('gsb_history');
    let local: HistorySession[] = [];
    try { local = stored ? JSON.parse(stored) : []; } catch {}
    // Prepend new session, persist only the user-logged sessions (not seed)
    local.unshift(newSession);
    localStorage.setItem('gsb_history', JSON.stringify(local));

    // Merge with seed for in-memory display
    setHistoryData(mergeHistory(local));

    // Attempt CSV save to API (only if there's actual set data)
    const csv = generateCSV();
    if (!csv || csv.split('\n').length <= 1) {
      setSavingStatus('saved');
      return;
    }

    setSavingStatus('saving');
    try {
      const res = await fetch('/api/save-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv })
      });
      if (res.ok) {
        setSavingStatus('saved');
      } else {
        // API unavailable (GitHub Pages) — localStorage save is enough
        setSavingStatus('saved');
      }
    } catch {
      // Offline — already saved to localStorage
      setSavingStatus('saved');
    }
  };

  const getCSVFilename = () => {
    if (!currentSessionKey) return 'GSB_workout.csv';
    const session = programme.sessions[currentSessionKey];
    const sessionType = (session.label.split(' — ')[1] || session.label)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    return `GSB_${sessionType}_${dateStr}.csv`;
  };

  const shareCSV = async () => {
    const csv = generateCSV();
    if (!csv || csv.split('\n').length <= 1) return;

    const filename = getCSVFilename();
    const file = new File([csv], filename, { type: 'text/csv' });

    // Try Web Share API with file sharing (iOS Safari share sheet)
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        // User cancelled or share failed — fall through to download
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }

    // Fallback: trigger a file download via anchor click
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleICloudSave = async () => {
    const csv = generateCSV();
    if (!csv || csv.split('\n').length <= 1) return;

    setICloudStatus('saving');

    // Try API endpoint first
    try {
      const res = await fetch('/api/save-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv })
      });
      if (res.ok) {
        setICloudStatus('saved');
        return;
      }
    } catch {
      // API unavailable — fall through to Web Share
    }

    // API failed (PWA/GitHub Pages) — use Web Share API for iOS Files/iCloud
    const filename = getCSVFilename();
    const file = new File([csv], filename, { type: 'text/csv' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        setICloudStatus('saved');
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') {
          setICloudStatus('idle');
          return;
        }
      }
    }

    // Final fallback: show share prompt state
    setICloudStatus('share');
  };

  /**
   * Parses and saves a manually entered past workout.
   * Format: one exercise per line — "Exercise Name: weight x reps, weight x reps"
   * or just "Exercise Name: notes"
   */
  const handleLogPastWorkout = () => {
    setLogFormError('');
    if (!logFormDate) { setLogFormError('Pick a date.'); return; }
    if (!logFormText.trim()) { setLogFormError('Enter at least one exercise.'); return; }

    // Format date as "yyyy-MM-dd (EEE)"
    const parsed = new Date(logFormDate + 'T12:00:00');
    const dateStr = format(parsed, 'yyyy-MM-dd (EEE)');

    const exercises: HistorySession['exercises'] = [];
    for (const raw of logFormText.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) {
        // No colon — treat entire line as exercise name with no data
        exercises.push({ exercise: line, weight: '', sets: '', reps: '', notes: '' });
        continue;
      }
      const name = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1).trim();
      // Each comma-separated chunk is a set: "80 x 8" or "80x8" or just "80"
      const setChunks = rest.split(',').map(s => s.trim()).filter(Boolean);
      const weights: string[] = [];
      const reps: string[] = [];
      let notes = '';
      for (const chunk of setChunks) {
        // Match "80 x 8", "80x8", "80kg x 8", "bw x 10" etc.
        const m = chunk.match(/^([^\s]+?)\s*[xX]\s*(\S+)/);
        if (m) {
          weights.push(m[1].replace(/kg$/i, ''));
          reps.push(m[2]);
        } else if (/^\d/.test(chunk) || /^bw/i.test(chunk)) {
          // Just a weight with no reps
          weights.push(chunk.replace(/kg$/i, ''));
        } else {
          // Treat as a note
          notes = notes ? `${notes}; ${chunk}` : chunk;
        }
      }
      exercises.push({
        exercise: name,
        weight: weights.join('/'),
        sets: weights.length > 0 ? String(weights.length) : '',
        reps: reps.join('/'),
        notes,
      });
    }

    if (exercises.length === 0) { setLogFormError('Could not parse any exercises.'); return; }

    const newSession: HistorySession = { date: dateStr, sessionType: logFormSessionType, exercises };
    const stored = localStorage.getItem('gsb_history');
    let local: HistorySession[] = [];
    try { local = stored ? JSON.parse(stored) : []; } catch {}
    // Check for duplicate
    const key = `${dateStr}|${logFormSessionType}`;
    if (local.some(s => `${s.date}|${s.sessionType}` === key)) {
      setLogFormError('A session with this date and type already exists.');
      return;
    }
    local.unshift(newSession);
    localStorage.setItem('gsb_history', JSON.stringify(local));
    setHistoryData(mergeHistory(local));

    // Reset form
    setLogFormOpen(false);
    setLogFormDate('');
    setLogFormText('');
    setHistoryOpen(true);
    if ('vibrate' in navigator) navigator.vibrate(50);
  };

  // ─── Desktop breakpoint + force-mobile ────────────────────────────────────
  const [forceMobile, setForceMobile] = useState<boolean>(() => {
    try { return localStorage.getItem('gsb_force_mobile') === 'true'; } catch { return false; }
  });
  const [isDesktopWidth, setIsDesktopWidth] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktopWidth(e.matches);
    setIsDesktopWidth(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleToggleForceMobile = () => {
    const next = !forceMobile;
    setForceMobile(next);
    try { localStorage.setItem('gsb_force_mobile', String(next)); } catch {}
  };

  // Render desktop shell when width >= 768px AND force-mobile is off
  if (isDesktopWidth && !forceMobile) {
    return (
      <DesktopApp
        forceMobile={forceMobile}
        onToggleForceMobile={handleToggleForceMobile}
      />
    );
  }

  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30 selection:text-white relative" style={{ background: '#000' }}>
      <div className="app-bg" />

      <div className="relative z-10">
      <AnimatePresence mode="wait">
        {screen === 'select' && (() => {
          const { sessionKey: todaySessionKey, session: todaySession } = getTodaySession(programme, historyData);
          const otherSessions = getSessionPriorityOrder(programme, todaySessionKey);
          const { schedule: weekSchedule, completedDows: completedThisWeek, completedCount, totalScheduled } = getWeeklyProgress(
            historyData, startOfWeek, endOfWeek, isWithinInterval,
          );
          const todayDow2 = new Date().getDay();

          return (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="max-w-2xl mx-auto px-4 pt-14 pb-10"
          >
            <header className="mb-7">
              <p className="text-[13px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--label-tertiary)' }}>{format(new Date(), 'EEEE')}</p>
              <p className="text-[34px] font-bold text-white leading-tight tracking-tight">{format(new Date(), 'MMMM d')}</p>
            </header>

            {/* Restore session banner */}
            <AnimatePresence>
              {undoSession && (() => {
                const undoSessionInfo = programme.sessions[undoSession.sessionKey];
                const minsAgo = Math.round((Date.now() - undoSession.savedAt) / 60000);
                const timeLabel = minsAgo < 1 ? 'just now' : `${minsAgo}m ago`;
                const loggedCount = (Object.values(undoSession.setData) as SetEntry[][]).reduce(
                  (acc, sets) => acc + sets.filter(s => s.logged).length, 0
                );
                return (
                  <motion.div
                    key="undo-banner"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="mb-4 rounded-2xl px-4 py-3"
                    style={{ background: '#1c1c1e', border: '1px solid rgba(255,159,10,0.25)' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(255,159,10,0.15)' }}>
                        <RotateCcw className="w-4 h-4" style={{ color: 'var(--tint-orange)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-white leading-snug">Session ended early</p>
                        <p className="text-[12px] leading-snug truncate" style={{ color: 'var(--label-secondary)' }}>
                          {undoSessionInfo?.label?.split(' — ')[1] || undoSession.sessionKey} · {loggedCount} set{loggedCount !== 1 ? 's' : ''} · {timeLabel}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => {
                            localStorage.setItem('liftoff_session', JSON.stringify(undoSession));
                            localStorage.removeItem('liftoff_session_undo');
                            setUndoSession(null);
                            startSession(undoSession.sessionKey, true);
                          }}
                          className="px-3 py-1.5 rounded-xl text-[13px] font-semibold transition-all"
                          style={{ background: 'rgba(255,159,10,0.18)', color: 'var(--tint-orange)' }}
                        >
                          Restore
                        </motion.button>
                        <button
                          onClick={() => { localStorage.removeItem('liftoff_session_undo'); setUndoSession(null); }}
                          className="p-1 transition-colors"
                          style={{ color: 'var(--label-tertiary)' }}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>

            {/* Weekly activity rings row */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-2xl px-4 py-4"
              style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-semibold text-white">This Week</span>
                <span className="text-[13px]" style={{ color: 'var(--label-tertiary)' }}>{completedCount} of {totalScheduled}</span>
              </div>
              <div className="flex justify-between overflow-hidden">
                {WEEK_SCHEDULE.map(({ day, dow }) => {
                  const isToday = dow === todayDow2;
                  const isDone = completedThisWeek.has(dow);
                  const isRest = dow === 1;
                  return (
                    <div key={dow} className="flex flex-col items-center gap-1" style={{ minWidth: 0, flex: '1 1 0' }}>
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                        style={{
                          background: isDone && !isRest ? 'var(--ring-exercise)' : isDone && isRest ? '#3a3a3c' : '#2c2c2e',
                          ...(isToday ? { boxShadow: `0 0 0 2px #000, 0 0 0 3px ${isDone ? 'var(--ring-exercise)' : 'rgba(255,255,255,0.35)'}` } : {})
                        }}
                      >
                        {isDone && !isRest && (
                          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        {isRest && <Moon className="w-3 h-3" style={{ color: 'var(--label-tertiary)' }} />}
                      </div>
                      <span className="text-[9px] font-medium uppercase tracking-tight text-center"
                        style={{ color: isToday ? 'white' : 'var(--label-tertiary)' }}
                      >{day}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>

            {/* Today's Session — Hero Card */}
            {todaySession && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="mb-4"
              >
                <p className="text-[13px] font-semibold mb-2 px-1" style={{ color: 'var(--label-tertiary)' }}>Today</p>
                <div className="rounded-2xl overflow-hidden" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {/* Accent stripe */}
                  <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, var(--ring-move), var(--ring-exercise))' }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex-1 min-w-0 pr-4">
                        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ring-exercise)' }}>{(todaySession.focus ?? '').split(',')[0].split('—')[0].trim()}</span>
                        <h2 className="text-[22px] font-bold text-white mt-0.5 leading-tight tracking-tight">
                          {todaySession.label.split(' — ')[1] || todaySession.label}
                        </h2>
                        <p className="text-[13px] mt-0.5" style={{ color: 'var(--label-tertiary)' }}>{todaySession.label.split(' — ')[0]}</p>
                      </div>
                      {/* Mini ring decoration */}
                      <div className="shrink-0 w-14 h-14 relative">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 44 44">
                          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(250,62,93,0.18)" strokeWidth="4" />
                          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--ring-move)" strokeWidth="4" strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 18 * 0.72} ${2 * Math.PI * 18 * 0.28}`} />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Dumbbell className="w-4 h-4 text-white/50" />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3 mb-5">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium" style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}>
                        <Timer className="w-3 h-3" />
                        {todaySession.estimated_duration_minutes}m
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium" style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}>
                        <Dumbbell className="w-3 h-3" />
                        {isCardioDay(todaySession) ? 'Cardio' : isRestDay(todaySession) ? 'Rest Day' : `${getSessionExercises(todaySession).length} exercises`}
                      </span>
                    </div>

                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => startSession(todaySessionKey)}
                      className="w-full flex items-center justify-center gap-2 text-white font-semibold py-3.5 rounded-2xl transition-all text-[15px]"
                      style={{ background: 'var(--ring-move)' }}
                    >
                      Start Workout
                      <ArrowRight className="w-4 h-4" />
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Milestone proximity alert */}
            <AnimatePresence>
              {milestoneAlert && !milestoneAlertDismissed && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="mb-4 rounded-2xl px-4 py-3 flex items-center gap-3"
                  style={{ background: '#1c1c1e', border: '1px solid rgba(255,159,10,0.2)' }}
                >
                  <TrendingUp className="w-4 h-4 shrink-0" style={{ color: 'var(--tint-orange)' }} />
                  <p className="flex-1 text-[13px] leading-snug" style={{ color: 'var(--label-secondary)' }}>
                    <span className="text-white font-semibold">{milestoneAlert.milestone}kg {milestoneAlert.exercise.replace('Barbell ', '')}</span> is ~{milestoneAlert.sessionsAway} session{milestoneAlert.sessionsAway !== 1 ? 's' : ''} away
                  </p>
                  <button onClick={() => setMilestoneAlertDismissed(true)} className="shrink-0 p-1" style={{ color: 'var(--label-tertiary)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Other Sessions — grouped list iOS style */}
            <div className="mb-6">
              <p className="text-[13px] font-semibold mb-2 px-1" style={{ color: 'var(--label-tertiary)' }}>Other Sessions</p>
              <div className="rounded-2xl overflow-hidden" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
                {otherSessions.map(([key, session], i) => {
                  const SESSION_TO_DAY: Record<string, string> = {
                    push_b: 'Mon', pull_b: 'Tue', cardio_day: 'Wed',
                    day_7: 'Thu', legs_core: 'Fri', push_a: 'Sat', pull_a: 'Sun'
                  };
                  return (
                    <motion.button
                      key={key}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => startSession(key)}
                      className="w-full flex items-center px-4 py-3.5 text-left transition-colors list-row"
                      style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--label-tertiary)' }}>
                            {SESSION_TO_DAY[key] || ''} · {(session.focus ?? '').split(',')[0].split('—')[0].trim()}
                          </span>
                        </div>
                        <h3 className="text-[15px] font-semibold text-white leading-snug">
                          {session.label.split(' — ')[1] || session.label}
                        </h3>
                        <span className="text-[12px]" style={{ color: 'var(--label-tertiary)' }}>
                          {session.estimated_duration_minutes}m · {isCardioDay(session) ? 'Cardio' : isRestDay(session) ? 'Rest' : `${getSessionExercises(session).length} exercises`}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--label-quaternary)' }} />
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Past Workouts — grouped section */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-6"
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--label-tertiary)' }}>History</p>
                <button
                  onClick={() => { setLogFormOpen(o => !o); setLogFormError(''); }}
                  className="flex items-center gap-1 text-[13px] font-medium transition-colors"
                  style={{ color: 'var(--tint-blue)' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Log Past
                </button>
              </div>

              {/* Manual log form */}
              <AnimatePresence>
                {logFormOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden mb-3"
                  >
                    <div className="rounded-2xl p-4 space-y-3" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="text-[13px] font-semibold text-white">Log Past Workout</p>

                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-widest mb-1.5" style={{ color: 'var(--label-tertiary)' }}>Date</label>
                        <input
                          type="date"
                          value={logFormDate}
                          onChange={e => setLogFormDate(e.target.value)}
                          className="w-full rounded-xl px-3 py-2.5 text-[14px] text-white focus:outline-none glass-input"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-widest mb-1.5" style={{ color: 'var(--label-tertiary)' }}>Session Type</label>
                        <select
                          value={logFormSessionType}
                          onChange={e => setLogFormSessionType(e.target.value)}
                          className="w-full rounded-xl px-3 py-2.5 text-[14px] text-white focus:outline-none glass-input appearance-none"
                        >
                          {['Push A (Heavy)', 'Push B (Pump)', 'Pull A (Heavy)', 'Pull B (Pump)', 'Legs + Core', 'Cardio', 'Push', 'Pull', 'Other'].map(t => (
                            <option key={t} value={t} style={{ background: '#1c1c1e' }}>{t}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-widest mb-1" style={{ color: 'var(--label-tertiary)' }}>Exercises</label>
                        <p className="text-[11px] mb-1.5" style={{ color: 'var(--label-quaternary)' }}>One per line — <span className="font-mono">Exercise: 80 x 8, 85 x 6</span></p>
                        <textarea
                          value={logFormText}
                          onChange={e => setLogFormText(e.target.value)}
                          placeholder={"Bench Press: 70 x 10, 80 x 8, 90 x 6\nOHP: 40 x 10, 40 x 8"}
                          rows={4}
                          className="w-full rounded-xl px-3 py-2.5 text-[13px] text-white focus:outline-none glass-input font-mono resize-none"
                          style={{ color: 'var(--label-primary)', caretColor: 'var(--tint-blue)' }}
                        />
                      </div>

                      {logFormError && (
                        <p className="text-[12px] font-medium" style={{ color: 'var(--tint-red)' }}>{logFormError}</p>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { setLogFormOpen(false); setLogFormError(''); }}
                          className="flex-1 py-2.5 rounded-xl text-[14px] font-medium transition-all"
                          style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleLogPastWorkout}
                          className="flex-1 py-2.5 rounded-xl text-[14px] font-semibold text-white transition-all"
                          style={{ background: 'var(--tint-blue)' }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="w-full flex items-center px-4 py-4 rounded-2xl transition-colors list-row"
                style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center mr-3 shrink-0" style={{ background: 'rgba(26,204,255,0.15)' }}>
                  <History className="w-4 h-4" style={{ color: 'var(--ring-stand)' }} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[15px] font-semibold text-white">Workout History</p>
                  <p className="text-[12px]" style={{ color: 'var(--label-tertiary)' }}>{historyData.length} sessions</p>
                </div>
                <motion.div animate={{ rotate: historyOpen ? 90 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                  <ChevronRight className="w-4 h-4" style={{ color: 'var(--label-quaternary)' }} />
                </motion.div>
              </button>

              <AnimatePresence>
                {historyOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 rounded-2xl overflow-hidden" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
                      {historyData.length === 0 ? (
                        <div className="py-10 text-center text-[14px]" style={{ color: 'var(--label-tertiary)' }}>No workouts logged yet</div>
                      ) : (
                        historyData.map((session, i) => (
                          <HistoryCard key={i} session={session} index={i} total={historyData.length} />
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
          );
        })()}

        {screen === 'workout' && currentSessionKey && (
          <motion.div
            key="workout"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pb-36"
          >
            <header className="sticky top-0 z-30 glass-header px-5 pt-safe pb-3" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}>
              <div className="max-w-2xl mx-auto flex items-center justify-between">
                <button
                  onClick={() => {
                    if (confirm('Exit workout? Progress will be saved.')) {
                      saveProgress(currentSessionKey, setData, skipped, elapsed);
                      setScreen('select');
                    }
                  }}
                  className="p-2 -ml-2 transition-colors"
                  style={{ color: 'var(--tint-blue)' }}
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="text-center">
                  <h2 className="text-[14px] font-semibold text-white">
                    {programme.sessions[currentSessionKey].label.split(' — ')[1]}
                  </h2>
                  <div className="flex items-center justify-center gap-1.5 mt-0.5">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      isTimerRunning ? "animate-pulse" : ""
                    )} style={{ background: isTimerRunning ? 'var(--ring-exercise)' : 'var(--tint-orange)' }} />
                    <span className="text-[15px] font-semibold tabular-nums" style={{ color: 'var(--label-secondary)' }}>{formatTime(elapsed)}</span>
                  </div>
                </div>
                <button
                  onClick={() => setIsTimerRunning(!isTimerRunning)}
                  className="p-2 -mr-2 transition-colors"
                  style={{ color: 'var(--label-secondary)' }}
                >
                  {isTimerRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
              </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
              {getSessionExercises(programme.sessions[currentSessionKey]).map((ex, idx) => (
                <ExerciseCard
                  key={idx}
                  idx={idx}
                  exercise={ex}
                  sets={setData[idx] || []}
                  isSkipped={skipped[idx]}
                  ghostWeights={recommendedWeights[ex.name] ?? []}
                  rpe={exerciseRpe[idx] ?? 7}
                  lastSession={lastSessionByEx[idx] ?? null}
                  sparklineData={sparklinesByEx[idx] ?? []}
                  onUpdateSet={(si, field, val) => {
                    const newData = { ...setData };
                    newData[idx][si] = { ...newData[idx][si], [field]: val };
                    setSetData(newData);
                    saveProgress(currentSessionKey, newData, skipped, elapsed);

                    // PR detection — only when both weight and reps are filled
                    if (ex.type === 'weight') {
                      const updatedSet = { ...newData[idx][si], [field]: val };
                      const w = parseFloat(updatedSet.weight);
                      const r = parseInt(updatedSet.reps);
                      if (!isNaN(w) && w > 0 && !isNaN(r) && r > 0) {
                        const canonical = normaliseExerciseName(ex.name);
                        const currentPR = prMap[canonical];
                        if (!currentPR || w > currentPR.weight) {
                          const oldWeight = currentPR?.weight ?? 0;
                          setNewPRBanner({ exercise: ex.name, weight: w, oldPR: oldWeight });
                          // Update prMap so it doesn't re-fire for same exercise this session
                          setPrMap(prev => ({
                            ...prev,
                            [canonical]: { weight: w, reps: r, date: new Date().toISOString().split('T')[0] }
                          }));
                          // Auto-dismiss after 3s
                          setTimeout(() => setNewPRBanner(null), 3000);
                        }
                      }
                    }
                  }}
                  onToggleSkip={() => {
                    const newSkipped = { ...skipped, [idx]: !skipped[idx] };
                    setSkipped(newSkipped);
                    saveProgress(currentSessionKey, setData, newSkipped, elapsed);
                  }}
                  onAddSet={() => {
                    const newData = { ...setData };
                    newData[idx].push({ weight: '', reps: '', note: '', logged: false });
                    setSetData(newData);
                  }}
                  onAddDropSet={() => {
                    const newData = { ...setData };
                    const currentSets = newData[idx];
                    const lastFilledSet = [...currentSets].reverse().find(s => s.weight !== '');
                    const dropWeight = lastFilledSet
                      ? String(Math.round(parseFloat(lastFilledSet.weight) * 0.8 * 2) / 2)
                      : '';
                    currentSets.push({ weight: dropWeight, reps: '', note: 'drop set', logged: false, isDropSet: true });
                    setSetData(newData);
                    saveProgress(currentSessionKey, newData, skipped, elapsed);
                  }}
                  onStartRest={(secs) => {
                    setRestTimer({ active: true, remaining: secs, total: secs, exName: ex.name });
                  }}
                  onRpeChange={(val) => {
                    setExerciseRpe(prev => ({ ...prev, [idx]: val }));
                  }}
                />
              ))}
            </main>

            <div className="fixed bottom-0 left-0 right-0 bottom-fade pointer-events-none" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)', padding: '20px 16px max(env(safe-area-inset-bottom, 0px), 16px)' }}>
              <div className="max-w-2xl mx-auto pointer-events-auto flex gap-3">
                <button
                  onClick={() => {
                    setIsTimerRunning(false);
                    const backup: SessionProgress = {
                      sessionKey: currentSessionKey!,
                      setData,
                      skipped,
                      elapsed,
                      savedAt: Date.now(),
                    };
                    localStorage.setItem('liftoff_session_undo', JSON.stringify(backup));
                    setUndoSession(backup);
                    localStorage.removeItem('liftoff_session');
                    setScreen('select');
                  }}
                  className="flex-1 font-semibold py-3.5 rounded-2xl transition-all active:scale-[0.97] text-[15px]"
                  style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}
                >
                  Quit
                </button>
                <button
                  onClick={handleFinish}
                  className="flex-[2] font-semibold py-3.5 rounded-2xl transition-all active:scale-[0.97] text-white text-[15px]"
                  style={{ background: 'var(--ring-exercise)', color: '#000' }}
                >
                  Finish Workout
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {screen === 'feedback' && (
          <FeedbackScreen
            onSubmit={handleFeedbackSubmit}
            onSkip={() => handleFeedbackSubmit(null)}
          />
        )}

        {screen === 'report' && currentSessionKey && (
          <ReportScreen
            sessionKey={currentSessionKey}
            setData={setData}
            skipped={skipped}
            elapsed={elapsed}
            evaluation={currentEvaluation}
            savingStatus={savingStatus}
            iCloudStatus={iCloudStatus}
            onICloudSave={handleICloudSave}
            onShareCSV={shareCSV}
            onDone={handleReportDone}
          />
        )}
      </AnimatePresence>

      {/* Rest Timer Overlay */}
      <AnimatePresence>
        {restTimer.active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 glass-overlay flex flex-col items-center justify-center px-8"
          >
            <span className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--label-tertiary)' }}>Rest</span>
            <h3 className="text-[17px] font-semibold text-white mb-10 text-center">{restTimer.exName}</h3>

            {/* Large ring */}
            <div className="relative w-52 h-52 mb-8">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
                <motion.circle
                  cx="50" cy="50" r="44"
                  fill="none"
                  stroke="var(--ring-stand)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="276.5"
                  animate={{ strokeDashoffset: 276.5 - (276.5 * (restTimer.remaining / restTimer.total)) }}
                  transition={{ duration: 1, ease: "linear" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[64px] font-light tabular-nums text-white leading-none" style={{ letterSpacing: '-0.03em' }}>
                  {restTimer.remaining}
                </span>
                <span className="text-[12px] font-medium uppercase tracking-widest mt-1" style={{ color: 'var(--label-tertiary)' }}>seconds</span>
              </div>
            </div>

            <div className="flex gap-3 w-full max-w-xs mb-8">
              <button
                onClick={() => setRestTimer(prev => ({ ...prev, active: false }))}
                className="flex-1 font-medium py-3.5 rounded-2xl text-[15px] transition-all active:scale-[0.97]"
                style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}
              >
                Skip
              </button>
              <button
                onClick={() => setRestTimer(prev => ({ ...prev, remaining: prev.remaining + 30, total: prev.total + 30 }))}
                className="flex-1 font-medium py-3.5 rounded-2xl text-[15px] text-white transition-all active:scale-[0.97]"
                style={{ background: 'var(--ring-stand)' }}
              >
                +30s
              </button>
            </div>

            {/* Synergist suggestion */}
            {!showCoachingCue && synergistSuggestion && !suggestionHidden && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="w-full max-w-xs rounded-2xl p-4"
                style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ring-stand)' }}>While you wait</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        if (currentSessionKey) {
                          const next = getSynergistSuggestion(currentSessionKey, historyData, exerciseRegistry, synergistSuggestion.exercise.name);
                          setSynergistSuggestion(next);
                        }
                      }}
                      className="p-1 transition-colors"
                      style={{ color: 'var(--label-tertiary)' }}
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setSuggestionHidden(true)} className="p-1 transition-colors" style={{ color: 'var(--label-tertiary)' }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[15px] font-semibold text-white capitalize">{synergistSuggestion.exercise.name}</p>
                <p className="text-[12px] mt-0.5 capitalize" style={{ color: 'var(--label-tertiary)' }}>
                  {synergistSuggestion.muscleGroup} · last: {synergistSuggestion.lastTrainedLabel}
                </p>
              </motion.div>
            )}

            <AnimatePresence>
              {showCoachingCue && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-[14px] text-center"
                  style={{ color: 'var(--label-secondary)' }}
                >
                  {coachingCueText}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PR Banner Overlay */}
      <AnimatePresence>
        {newPRBanner && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm"
            onClick={() => setNewPRBanner(null)}
          >
            <div className="rounded-2xl px-4 py-3.5 flex items-center gap-3"
              style={{ background: '#1c1c1e', border: '1px solid rgba(48,209,88,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(48,209,88,0.15)' }}>
                <TrendingUp className="w-4 h-4" style={{ color: 'var(--tint-green)' }} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--tint-green)' }}>New Personal Record</p>
                <p className="text-[15px] font-semibold text-white leading-tight">
                  {newPRBanner.exercise.replace(/^Barbell /, '')} — {newPRBanner.weight}kg
                </p>
                {newPRBanner.oldPR > 0 && (
                  <p className="text-[12px] font-medium" style={{ color: 'var(--tint-green)' }}>
                    +{(newPRBanner.weight - newPRBanner.oldPR).toFixed(1)}kg above previous
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

/** Inline SVG sparkline — 70×24px polyline of weight trend */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const W = 70, H = 24, PAD = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const xs = data.map((_, i) => PAD + (i / (data.length - 1)) * (W - PAD * 2));
  const ys = data.map(v => H - PAD - ((v - min) / range) * (H - PAD * 2));
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const fillPts = `${xs[0]},${H} ${pts} ${xs[xs.length - 1]},${H}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id="spk-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.08" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill="url(#spk-fill)" />
      <polyline points={pts} fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* last point dot */}
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2" fill="white" fillOpacity="0.5" />
    </svg>
  );
}

function ExerciseCard({
  idx,
  exercise,
  sets,
  isSkipped,
  ghostWeights,
  rpe,
  lastSession,
  sparklineData,
  onUpdateSet,
  onToggleSkip,
  onAddSet,
  onAddDropSet,
  onStartRest,
  onRpeChange
}: {
  idx: number;
  exercise: Exercise;
  sets: SetEntry[];
  isSkipped: boolean;
  ghostWeights: (number | null)[];
  rpe: number;
  lastSession: { weight: number; reps: number } | null;
  sparklineData: number[];
  onUpdateSet: (si: number, field: keyof SetEntry, val: any) => void;
  onToggleSkip: () => void;
  onAddSet: () => void;
  onAddDropSet: () => void;
  onStartRest: (secs: number) => void;
  onRpeChange: (val: number) => void;
  [key: string]: unknown;
}) {
  const [isOpen, setIsOpen] = useState(idx === 0);
  const isComplete = sets.every(s => s.weight !== '' && s.reps !== '');

  // Beat-last-session: find the best set logged so far this session
  const bestCurrentWeight = sets.reduce((best, s) => {
    const w = parseFloat(s.weight);
    return !isNaN(w) && w > best ? w : best;
  }, 0);
  const beatDelta = lastSession && bestCurrentWeight > 0 && lastSession.weight > 0
    ? bestCurrentWeight - lastSession.weight
    : null;

  return (
    <motion.div
      layout
      className="rounded-2xl overflow-hidden transition-all"
      style={{
        background: '#1c1c1e',
        border: isComplete && !isSkipped ? '1px solid rgba(48,209,88,0.25)' : '1px solid rgba(255,255,255,0.07)',
        opacity: isSkipped ? 0.45 : 1
      }}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-4 flex items-start gap-3 cursor-pointer active:bg-[#2c2c2e] transition-colors"
      >
        {/* Completion indicator dot */}
        <div className="mt-1 shrink-0">
          <div className="w-2 h-2 rounded-full" style={{
            background: isComplete && !isSkipped ? 'var(--tint-green)' :
              sets.some(s => s.weight || s.reps) ? 'var(--ring-stand)' :
              'rgba(255,255,255,0.15)'
          }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {exercise.superset_group && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-tighter"
                style={{ background: 'rgba(191,90,242,0.18)', color: 'var(--tint-purple)' }}>
                {exercise.superset_group}
              </span>
            )}
            <MarqueeText text={exercise.name} className="text-[16px] font-semibold text-white" />
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[13px]" style={{ color: 'var(--label-tertiary)' }}>
              {exercise.sets ? `${exercise.sets} × ` : ''}{exercise.reps || (exercise.duration_seconds ? `${exercise.duration_seconds}s` : '')}{exercise.rest_seconds ? ` · ${exercise.rest_seconds}s rest` : ''}
            </p>
            {beatDelta !== null && beatDelta > 0 && (
              <span className="text-[12px] font-medium" style={{ color: 'var(--tint-green)' }}>+{beatDelta % 1 === 0 ? beatDelta : beatDelta.toFixed(1)}kg</span>
            )}
          </div>
          {lastSession && lastSession.weight > 0 && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--label-quaternary)' }}>
              Last: {lastSession.weight}kg × {lastSession.reps}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sparklineData.length >= 2 && (
            <div className="opacity-50">
              <Sparkline data={sparklineData} />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSkip(); }}
            className="text-[12px] font-medium px-2.5 py-1 rounded-lg transition-all"
            style={{
              background: isSkipped ? 'rgba(255,159,10,0.15)' : '#2c2c2e',
              color: isSkipped ? 'var(--tint-orange)' : 'var(--label-tertiary)'
            }}
          >
            {isSkipped ? 'Undo' : 'Skip'}
          </button>
          <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 35 }}>
            <ChevronRight className="w-4 h-4" style={{ color: 'var(--label-quaternary)' }} />
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && !isSkipped && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 pb-4"
          >
            {/* Separator */}
            <div className="mb-4" style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

            {exercise.notes && (
              <div className="mb-4 px-3 py-2.5 rounded-xl text-[13px] leading-relaxed"
                style={{ background: 'rgba(191,90,242,0.08)', borderLeft: '3px solid var(--tint-purple)', color: 'var(--label-secondary)' }}>
                {exercise.notes}
              </div>
            )}

            {/* Column headers */}
            <div className="grid grid-cols-[24px_1fr_1fr_1.4fr] gap-2 px-1 mb-2">
              <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--label-quaternary)' }}>#</span>
              <span className="text-[11px] font-medium uppercase tracking-widest text-center" style={{ color: 'var(--label-quaternary)' }}>kg</span>
              <span className="text-[11px] font-medium uppercase tracking-widest text-center" style={{ color: 'var(--label-quaternary)' }}>Reps</span>
              <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--label-quaternary)' }}>Note</span>
            </div>

            <div className="space-y-2 mb-5">
              {sets.map((set, si) => (
                <div key={si} className="grid grid-cols-[24px_1fr_1fr_1.4fr] gap-2 items-center">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium transition-colors"
                    style={{
                      background: set.isDropSet && set.weight && set.reps ? 'rgba(255,159,10,0.18)' :
                        set.weight && set.reps ? 'rgba(48,209,88,0.18)' :
                        set.isDropSet ? 'rgba(255,159,10,0.08)' : '#2c2c2e',
                      color: set.isDropSet && set.weight && set.reps ? 'var(--tint-orange)' :
                        set.weight && set.reps ? 'var(--tint-green)' :
                        set.isDropSet ? 'rgba(255,159,10,0.4)' : 'var(--label-tertiary)'
                    }}>
                    {set.isDropSet ? <ChevronDown className="w-3 h-3" /> : si + 1}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder={ghostWeights[si] != null && ghostWeights[si]! > 0 ? String(ghostWeights[si]) : 'kg'}
                    value={set.weight}
                    onChange={(e) => onUpdateSet(si, 'weight', e.target.value)}
                    className={cn(
                      "w-full glass-input rounded-xl py-2 px-1 text-center text-[15px] font-semibold text-white focus:outline-none transition-all",
                      ghostWeights[si] != null && ghostWeights[si]! > 0 && set.weight === ''
                        ? "placeholder:text-emerald-400/60"
                        : "placeholder:text-white/18"
                    )}
                    style={{ '--tw-placeholder-opacity': 1 } as React.CSSProperties}
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder={exercise.type === 'timed' ? 'sec' : 'reps'}
                    value={set.reps}
                    onChange={(e) => onUpdateSet(si, 'reps', e.target.value)}
                    className="w-full glass-input rounded-xl py-2 px-1 text-center text-[15px] font-semibold text-white focus:outline-none transition-all"
                    style={{ '--placeholder-color': 'rgba(255,255,255,0.18)' } as React.CSSProperties}
                  />
                  <input
                    type="text"
                    placeholder="note"
                    value={set.note}
                    onChange={(e) => onUpdateSet(si, 'note', e.target.value)}
                    className="w-full glass-input rounded-xl py-2 px-2 text-[13px] focus:outline-none transition-all"
                    style={{ color: 'var(--label-secondary)' }}
                  />
                </div>
              ))}
            </div>

            {/* RPE picker */}
            {exercise.type === 'weight' && (
              <div className="mb-4 px-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--label-tertiary)' }}>Effort (RPE)</span>
                  <div className="flex items-center gap-1.5">
                    {[6, 7, 8, 9, 10].map(n => (
                      <button
                        key={n}
                        onClick={() => onRpeChange(n)}
                        className="w-8 h-8 rounded-xl text-[13px] font-semibold transition-all active:scale-90"
                        style={{
                          background: rpe === n ? 'var(--tint-blue)' : '#2c2c2e',
                          color: rpe === n ? '#fff' : 'var(--label-tertiary)'
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={onAddSet}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-all active:scale-[0.97] text-[13px] font-medium"
                style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}
              >
                <Plus className="w-3.5 h-3.5" />
                Set
              </button>
              <button
                onClick={onAddDropSet}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-all active:scale-[0.97] text-[13px] font-medium"
                style={{ background: 'rgba(255,159,10,0.12)', color: 'var(--tint-orange)' }}
              >
                <ChevronDown className="w-3.5 h-3.5" />
                Drop
              </button>
              <button
                onClick={() => onStartRest(exercise.rest_seconds ?? 60)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-all active:scale-[0.97] text-[13px] font-medium"
                style={{ background: 'rgba(29,204,255,0.12)', color: 'var(--ring-stand)' }}
              >
                <Timer className="w-3.5 h-3.5" />
                {exercise.rest_seconds ? `${exercise.rest_seconds}s` : 'Rest'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function HistoryCard({ session, index, total }: {
  session: { date: string; sessionType: string; exercises: { exercise: string; weight: string; sets: string; reps: string; notes: string }[] };
  index: number;
  total: number;
}) {
  return (
    <div
      className="px-4 py-3.5 flex items-center gap-3"
      style={{ borderTop: index > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#2c2c2e' }}>
        <Calendar className="w-4 h-4" style={{ color: 'var(--ring-stand)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-white leading-snug">{session.sessionType}</p>
        <p className="text-[12px]" style={{ color: 'var(--label-tertiary)' }}>{session.date} · {session.exercises.length} exercises</p>
      </div>
    </div>
  );
}

// ─── Feedback Screen ──────────────────────────────────────────────────────────

function FeedbackScreen({
  onSubmit,
  onSkip
}: {
  onSubmit: (f: PostSessionFeedback) => void;
  onSkip: () => void;
}) {
  // session rating: rough=2, solid=3, great=5
  const SESSION_OPTS: { label: string; emoji: string; value: 1 | 2 | 3 | 4 | 5 }[] = [
    { label: 'Rough', emoji: '👎', value: 2 },
    { label: 'Solid', emoji: '👊', value: 3 },
    { label: 'Great', emoji: '💪', value: 5 },
  ];
  // body/soreness: fresh=1, normal=3, beat_up=5
  const BODY_OPTS: { label: string; value: 1 | 2 | 3 | 4 | 5 }[] = [
    { label: 'Fresh', value: 1 },
    { label: 'Normal', value: 3 },
    { label: 'Beat Up', value: 5 },
  ];

  const [sessionRating, setSessionRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [bodyScore, setBodyScore] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [sleepHours, setSleepHours] = useState<number>(7);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notes, setNotes] = useState('');

  // energy_score: mirror session rating (rough=2 → drained, great=5 → energised)
  const energyFromRating = (r: number): 1 | 2 | 3 | 4 | 5 => {
    if (r <= 2) return 2;
    if (r === 3) return 3;
    return 5;
  };

  const handleSubmit = () => {
    onSubmit({
      soreness_score: bodyScore,
      energy_score: energyFromRating(sessionRating),
      sleep_hours: sleepHours,
      session_rating: sessionRating,
      notes: notes.trim() || undefined
    });
  };

  const adjustSleep = (delta: number) => {
    setSleepHours(prev => {
      const next = Math.round((prev + delta) * 2) / 2;
      return Math.max(3, Math.min(12, next));
    });
  };

  return (
    <motion.div
      key="feedback"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      className="max-w-2xl mx-auto px-4 pt-14 pb-10"
    >
      <header className="mb-8">
        <p className="text-[13px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--label-tertiary)' }}>Post-Session</p>
        <h1 className="text-[34px] font-bold text-white tracking-tight">How was that?</h1>
      </header>

      <div className="space-y-3 mb-8">
        {/* Input 1: Session feel */}
        <div className="rounded-2xl p-4" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-[12px] font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--label-tertiary)' }}>Session</p>
          <div className="grid grid-cols-3 gap-2">
            {SESSION_OPTS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSessionRating(opt.value)}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl font-medium transition-all active:scale-[0.95]"
                style={{
                  background: sessionRating === opt.value ? 'var(--tint-blue)' : '#2c2c2e',
                  color: sessionRating === opt.value ? '#fff' : 'var(--label-secondary)'
                }}
              >
                <span className="text-[28px] leading-none">{opt.emoji}</span>
                <span className="text-[13px]">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Input 2: Body feel */}
        <div className="rounded-2xl p-4" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-[12px] font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--label-tertiary)' }}>Body</p>
          <div className="flex gap-2">
            {BODY_OPTS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setBodyScore(opt.value)}
                className="flex-1 py-3 rounded-xl text-[14px] font-medium transition-all active:scale-[0.96]"
                style={{
                  background: bodyScore === opt.value ? 'var(--tint-green)' : '#2c2c2e',
                  color: bodyScore === opt.value ? '#000' : 'var(--label-secondary)'
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input 3: Sleep stepper */}
        <div className="rounded-2xl p-4" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4" style={{ color: 'var(--tint-purple)' }} />
              <p className="text-[14px] font-medium text-white">Sleep</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => adjustSleep(-0.5)}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 text-[18px] font-light"
                style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}
              >
                −
              </button>
              <span className="text-[22px] font-semibold text-white w-16 text-center tabular-nums" style={{ letterSpacing: '-0.02em' }}>
                {sleepHours}h
              </span>
              <button
                onClick={() => adjustSleep(0.5)}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 text-[18px] font-light"
                style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Optional note */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => setNoteOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-4 text-[14px] font-medium transition-colors"
            style={{ color: 'var(--label-tertiary)' }}
          >
            <span>Add a note</span>
            <motion.div animate={{ rotate: noteOpen ? 180 : 0 }} transition={{ duration: 0.15 }}>
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </button>
          <AnimatePresence>
            {noteOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Pain, PRs, conditions..."
                    rows={3}
                    autoFocus
                    className="w-full bg-transparent text-[14px] text-white placeholder:text-white/25 focus:outline-none resize-none mt-3"
                    style={{ color: 'var(--label-primary)', caretColor: 'var(--tint-blue)' }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 font-medium py-4 rounded-2xl transition-all active:scale-[0.97] text-[15px]"
          style={{ background: '#1c1c1e', color: 'var(--label-secondary)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          Skip
        </button>
        <button
          onClick={handleSubmit}
          className="flex-[2] font-semibold py-4 rounded-2xl transition-all active:scale-[0.97] text-[15px] text-white"
          style={{ background: 'var(--tint-blue)' }}
        >
          See Report
        </button>
      </div>
    </motion.div>
  );
}

// ─── Report Screen ────────────────────────────────────────────────────────────

// Compound lifts that get 1.5x weight in scoring
const COMPOUND_NAMES = [
  'barbell bench press',
  'barbell back squat',
  'romanian deadlift',
  'rdl',
  'overhead press',
  'ohp',
  'pull-up',
  'assisted pull-up',
];

// Week-8 targets and starting weights for progress bars
const PROGRESS_TARGETS: Record<string, { start: number; target: number; short: string }> = {
  'Barbell Bench Press': { start: 80, target: 97.5, short: 'Bench' },
  'Barbell Back Squat': { start: 90, target: 97.5, short: 'Squat' },
  'Assisted Pull-Up (Machine or Band)': { start: 0, target: 0, short: 'Pull-Up' }, // handled specially
};

function parseRepsUpper(reps: string | number | undefined): number {
  if (reps === undefined || reps === null) return 8;
  const s = String(reps);
  // "5-6" → 6, "8-12" → 12, "10 each leg" → 10, "12" → 12
  const match = s.match(/(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) return 8;
  return match[2] ? parseInt(match[2]) : parseInt(match[1]);
}

function isCompound(name: string): boolean {
  const lower = name.toLowerCase();
  return COMPOUND_NAMES.some(c => lower.includes(c));
}

interface ExerciseScore {
  name: string;
  prescribedWeight: number | null;
  prescribedReps: number;
  prescribedSets: number;
  actualWeight: number;
  actualReps: number;
  actualSets: number;
  rpe: number;
  loadRatio: number;
  repRatio: number;
  setRatio: number;
  score: number;
  isCompound: boolean;
  status: 'exceeded' | 'on_target' | 'missed' | 'no_data';
  weightDelta: number; // kg above/below
  repsDelta: number;
}

function computeSessionScore(
  sessionKey: string,
  setData: { [exIdx: number]: SetEntry[] },
  skipped: { [exIdx: number]: boolean },
  exerciseRpe: { [exIdx: number]: number }
): { score: number; label: string; exerciseScores: ExerciseScore[] } {
  const session = programme.sessions[sessionKey];
  if (!session) return { score: 0, label: 'Off day', exerciseScores: [] };
  const exercises = getSessionExercises(session);

  const exerciseScores: ExerciseScore[] = [];

  for (let idx = 0; idx < exercises.length; idx++) {
    const ex = exercises[idx];
    if (ex.type !== 'weight') continue;
    if (skipped[idx]) continue;

    const sets = (setData[idx] || []).filter(s => s.weight !== '' && s.reps !== '');
    if (sets.length === 0) continue;

    const prescribedReps = parseRepsUpper(ex.reps);
    const prescribedSets = ex.sets || 1;

    // Best weight = highest weight across all sets
    const weights = sets.map(s => parseFloat(s.weight) || 0);
    const repsBySet = sets.map(s => parseInt(s.reps) || 0);
    const bestWeight = Math.max(...weights);
    // Reps at best weight (if multiple sets at that weight, use max reps)
    const topSetIdx = weights.indexOf(bestWeight);
    const topSetReps = repsBySet[topSetIdx] ?? Math.max(...repsBySet);

    // Get prescribed weight from last history entry
    // We don't have history here, so use the coaching engine evaluation if available
    // For the report we'll look it up from the evaluation passed in
    const prescribedWeight = null; // will be enriched by caller

    const loadRatio = prescribedWeight !== null && prescribedWeight > 0
      ? Math.min(1.2, bestWeight / prescribedWeight)
      : 1.0; // no target available
    const repRatio = Math.min(1.2, topSetReps / prescribedReps);
    const setRatio = Math.min(1.2, sets.length / prescribedSets);

    const rawScore = (loadRatio + repRatio + setRatio) / 3;
    const score = Math.min(1.0, rawScore);
    const rpe = exerciseRpe[idx] ?? 7;

    // Determine status based on rep ratio (primary metric since weight target is often unknown)
    let status: ExerciseScore['status'];
    if (topSetReps >= prescribedReps + 1) status = 'exceeded';
    else if (topSetReps >= prescribedReps) status = 'on_target';
    else if (topSetReps >= prescribedReps - 2) status = 'on_target';
    else status = 'missed';

    exerciseScores.push({
      name: ex.name,
      prescribedWeight,
      prescribedReps,
      prescribedSets,
      actualWeight: bestWeight,
      actualReps: topSetReps,
      actualSets: sets.length,
      rpe,
      loadRatio,
      repRatio,
      setRatio,
      score,
      isCompound: isCompound(ex.name),
      status,
      weightDelta: prescribedWeight !== null ? bestWeight - prescribedWeight : 0,
      repsDelta: topSetReps - prescribedReps,
    });
  }

  // Weighted average: compounds 1.5x
  let totalWeighted = 0;
  let totalWeight = 0;
  for (const es of exerciseScores) {
    const w = es.isCompound ? 1.5 : 1.0;
    totalWeighted += es.score * w;
    totalWeight += w;
  }
  const sessionScore = totalWeight > 0 ? Math.round((totalWeighted / totalWeight) * 100) : 0;

  // Determine label
  const avgRpe = exerciseScores.length > 0
    ? exerciseScores.reduce((a, b) => a + b.rpe, 0) / exerciseScores.length
    : 0;
  const compoundsMissed = exerciseScores.filter(e => e.isCompound && e.status === 'missed').length;
  const highRpe = exerciseScores.some(e => e.rpe >= 9.5);

  let label: string;
  if (sessionScore >= 95 && !highRpe) {
    label = 'Crushed it';
  } else if (sessionScore >= 80) {
    label = 'Solid session';
  } else if (sessionScore >= 65 || avgRpe >= 9) {
    label = 'Grinding';
  } else if (sessionScore < 65 || compoundsMissed >= 2) {
    label = 'Off day';
  } else {
    label = 'Grinding';
  }

  return { score: sessionScore, label, exerciseScores };
}

function rpeNote(status: ExerciseScore['status'], rpe: number): string | null {
  if (status === 'exceeded' && rpe <= 8) return 'Green light — programme up';
  if ((status === 'on_target' || status === 'exceeded') && rpe <= 7) return 'Underloaded — increase next session';
  if (status === 'on_target' && rpe >= 7.5 && rpe <= 8.5) return 'Perfectly calibrated';
  if ((status === 'on_target' || status === 'exceeded') && rpe >= 9) return 'Hit it, but costly';
  if (status === 'missed' && rpe <= 7) return 'Left reps in the tank';
  if (status === 'missed' && rpe >= 9) return 'Genuinely hard — recover and retest';
  return null;
}

function ReportScreen({
  sessionKey,
  setData,
  skipped,
  elapsed,
  evaluation,
  savingStatus,
  iCloudStatus,
  onICloudSave,
  onShareCSV,
  onDone,
}: {
  sessionKey: string;
  setData: { [exIdx: number]: SetEntry[] };
  skipped: { [exIdx: number]: boolean };
  elapsed: number;
  evaluation: SessionEvaluation | null;
  savingStatus: 'idle' | 'saving' | 'saved' | 'error';
  iCloudStatus: 'idle' | 'saving' | 'saved' | 'share';
  onICloudSave: () => void;
  onShareCSV: () => void;
  onDone: (acceptedWeights: Record<string, number>) => void;
}) {
  const [showAllExercises, setShowAllExercises] = useState(false);
  const [acceptedWeights, setAcceptedWeights] = useState<Record<string, number>>({});
  const [ringAnimated, setRingAnimated] = useState(false);

  useEffect(() => {
    // Trigger ring animation after mount
    const t = setTimeout(() => setRingAnimated(true), 100);
    return () => clearTimeout(t);
  }, []);

  // Pull exercise RPE values from the evaluation's exercise evaluations as a proxy
  // We need them indexed by exercise name
  const evalRpeByName: Record<string, number> = {};
  if (evaluation) {
    for (const ee of evaluation.exercise_evaluations) {
      // Use the midpoint of prescribed RPE as a reference; we'll use the rpe_delta to infer actual
      const midRpe = (ee.prescribed_rpe_min + ee.prescribed_rpe_max) / 2;
      evalRpeByName[ee.exercise_name] = Math.min(10, Math.max(1, midRpe + ee.rpe_delta));
    }
  }

  // Build exercise RPE map indexed by exercise index
  const session = programme.sessions[sessionKey];
  const exercises = getSessionExercises(session);
  const exerciseRpeByIdx: { [exIdx: number]: number } = {};
  exercises.forEach((ex, idx) => {
    if (evalRpeByName[ex.name] !== undefined) {
      exerciseRpeByIdx[idx] = evalRpeByName[ex.name];
    }
  });

  const { score, label, exerciseScores } = computeSessionScore(
    sessionKey, setData, skipped, exerciseRpeByIdx
  );

  // Enrich exercise scores with prescribed weight from evaluation
  if (evaluation) {
    for (const es of exerciseScores) {
      const ee = evaluation.exercise_evaluations.find(e => e.exercise_name === es.name);
      if (ee && ee.prescribed_weight !== null) {
        es.prescribedWeight = ee.prescribed_weight;
        es.weightDelta = es.actualWeight - ee.prescribed_weight;
        // Re-compute load ratio and status with actual prescribed weight
        es.loadRatio = Math.min(1.2, es.actualWeight / ee.prescribed_weight);
        if (es.weightDelta > 1) es.status = 'exceeded';
        else if (es.weightDelta >= -2.5) es.status = 'on_target';
        else es.status = 'missed';
      }
      // Also update RPE from eval
      const ee2 = evaluation.exercise_evaluations.find(e => e.exercise_name === es.name);
      if (ee2) {
        const midRpe = (ee2.prescribed_rpe_min + ee2.prescribed_rpe_max) / 2;
        es.rpe = Math.min(10, Math.max(1, midRpe + ee2.rpe_delta));
      }
    }
  }

  // Key callouts: exceeded compounds, missed compounds, anything notable
  const callouts = exerciseScores.filter(es => {
    if (es.status === 'exceeded') return true;
    if (es.isCompound && es.status === 'missed') return true;
    // Also flag compounds hit at very high RPE
    if (es.isCompound && es.status === 'on_target' && es.rpe >= 9) return true;
    return false;
  }).slice(0, 3);

  // Adj summary lines
  const adjLines: string[] = [];
  if (evaluation) {
    for (const adj of evaluation.adjustments.filter(a => a.type !== 'informational').slice(0, 3)) {
      const shortName = adj.exercise_name.replace(/^Barbell /, '').replace(/^Assisted /, '').split(' ')[0];
      if (adj.type === 'weight_increase') {
        adjLines.push(`${shortName} increases to ${adj.recommended_value}kg next session`);
      } else if (adj.type === 'weight_reduction') {
        adjLines.push(`${shortName} drops to ${adj.recommended_value}kg — RPE was high`);
      } else if (adj.type === 'deload') {
        adjLines.push(`${shortName} deload: ${adj.recommended_value}kg`);
      }
    }
  }

  // Progress bar data — key compounds toward week-8
  const progressBars = exerciseScores
    .filter(es => PROGRESS_TARGETS[es.name] && PROGRESS_TARGETS[es.name].target > 0)
    .map(es => {
      const tgt = PROGRESS_TARGETS[es.name];
      const progress = tgt.start >= tgt.target
        ? 1
        : Math.max(0, Math.min(1, (es.actualWeight - tgt.start) / (tgt.target - tgt.start)));
      // Status from evaluation projections
      let statusLabel = 'On track';
      let statusColor = 'text-emerald-400';
      if (evaluation) {
        const proj = evaluation.projections.find(p => p.exercise_name === es.name);
        if (proj) {
          if (proj.status === 'behind') { statusLabel = 'Behind'; statusColor = 'text-amber-400'; }
          else if (proj.status === 'ahead') { statusLabel = 'Ahead'; statusColor = 'text-violet-400'; }
        }
      }
      return { name: tgt.short, fullName: es.name, current: es.actualWeight, target: tgt.target, progress, statusLabel, statusColor };
    });

  // SVG ring constants (circumference for r=45)
  const circumference = 2 * Math.PI * 45;
  const dashoffset = circumference - (circumference * score) / 100;

  const labelColors: Record<string, string> = {
    'Crushed it': 'var(--tint-green)',
    'Solid session': 'var(--tint-blue)',
    'Grinding': 'var(--tint-orange)',
    'Off day': 'var(--tint-red)',
  };
  const ringGradients: Record<string, [string, string]> = {
    'Crushed it': ['var(--ring-exercise)', 'var(--tint-green)'],
    'Solid session': ['var(--ring-stand)', 'var(--tint-blue)'],
    'Grinding': ['var(--tint-orange)', '#ffcc00'],
    'Off day': ['var(--ring-move)', 'var(--tint-red)'],
  };
  const [gradStart, gradEnd] = ringGradients[label] ?? ['var(--ring-move)', 'var(--ring-exercise)'];

  const handleDone = () => {
    // Auto-accept all weight adjustments from the evaluation
    const weights: Record<string, number> = {};
    if (evaluation) {
      for (const adj of evaluation.adjustments) {
        if (adj.type === 'weight_increase' || adj.type === 'weight_reduction' || adj.type === 'deload') {
          weights[adj.exercise_name] = adj.recommended_value;
        }
      }
    }
    onDone(weights);
  };

  return (
    <motion.div
      key="report"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      className="max-w-2xl mx-auto px-4 pt-14 pb-56"
    >
      {/* Top: Score Ring */}
      <div className="flex flex-col items-center mb-10">
        <p className="text-[12px] font-medium uppercase tracking-widest mb-6" style={{ color: 'var(--label-tertiary)' }}>Session Report</p>

        {/* Ring */}
        <div className="relative w-36 h-36 mb-5">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="44"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="6"
            />
            <motion.circle
              cx="50" cy="50" r="44"
              fill="none"
              stroke={`url(#scoreGrad-${label.replace(/ /g, '')})`}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: ringAnimated ? dashoffset : circumference }}
              transition={{ duration: 1.4, ease: [0.34, 1.1, 0.64, 1] }}
            />
            <defs>
              <linearGradient id={`scoreGrad-${label.replace(/ /g, '')}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={gradStart} />
                <stop offset="100%" stopColor={gradEnd} />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              className="tabular-nums text-white leading-none"
              style={{ fontSize: '36px', fontWeight: 300, letterSpacing: '-0.03em' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {score}%
            </motion.span>
          </div>
        </div>

        <motion.h1
          className="text-[28px] font-semibold tracking-tight"
          style={{ color: labelColors[label] ?? '#fff' }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          {label}
        </motion.h1>

        {/* Quick stats */}
        <motion.div
          className="flex gap-6 mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.65 }}
        >
          <div className="text-center">
            <span className="block tabular-nums text-white leading-none" style={{ fontSize: '26px', fontWeight: 300, letterSpacing: '-0.03em' }}>{Math.round(elapsed / 60)}</span>
            <span className="text-[11px] font-medium uppercase tracking-widest mt-1 block" style={{ color: 'var(--label-tertiary)' }}>min</span>
          </div>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }} />
          <div className="text-center">
            <span className="block tabular-nums text-white leading-none" style={{ fontSize: '26px', fontWeight: 300, letterSpacing: '-0.03em' }}>
              {Object.values(setData).flat().filter((s: SetEntry) => s.weight !== '' || s.reps !== '').length}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-widest mt-1 block" style={{ color: 'var(--label-tertiary)' }}>sets</span>
          </div>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }} />
          <div className="text-center">
            <span className="block tabular-nums text-white leading-none" style={{ fontSize: '26px', fontWeight: 300, letterSpacing: '-0.03em' }}>{exerciseScores.length}</span>
            <span className="text-[11px] font-medium uppercase tracking-widest mt-1 block" style={{ color: 'var(--label-tertiary)' }}>exercises</span>
          </div>
        </motion.div>
      </div>

      {/* Highlights */}
      {callouts.length > 0 && (
        <motion.div className="mb-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}>
          <p className="text-[13px] font-medium mb-2 px-1" style={{ color: 'var(--label-tertiary)' }}>Highlights</p>
          <div className="rounded-2xl overflow-hidden" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.07)' }}>
            {callouts.map((es, i) => {
              const isExceeded = es.status === 'exceeded';
              const isMissed = es.status === 'missed';
              const note = rpeNote(es.status, es.rpe);
              const shortName = es.name.replace(/^Barbell /, '').replace(/^Assisted /, '');
              const accentColor = isExceeded ? 'var(--tint-green)' : isMissed ? 'var(--tint-orange)' : 'var(--label-secondary)';
              return (
                <div key={i} className="px-4 py-3.5" style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-semibold text-white">{shortName}</span>
                    <span className="text-[13px] font-medium tabular-nums" style={{ color: accentColor }}>{es.actualWeight}kg × {es.actualReps}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {es.prescribedWeight !== null && es.weightDelta !== 0 && (
                      <span className="text-[12px]" style={{ color: accentColor }}>
                        {es.weightDelta > 0 ? '+' : ''}{es.weightDelta.toFixed(1)}kg vs target
                      </span>
                    )}
                    {es.prescribedWeight === null && es.repsDelta !== 0 && (
                      <span className="text-[12px]" style={{ color: accentColor }}>
                        {es.repsDelta > 0 ? '+' : ''}{es.repsDelta} reps vs target
                      </span>
                    )}
                    <span className="text-[12px] ml-auto" style={{ color: 'var(--label-quaternary)' }}>RPE {es.rpe.toFixed(1)}</span>
                  </div>
                  {note && <p className="text-[12px] mt-0.5 italic" style={{ color: 'var(--label-quaternary)' }}>{note}</p>}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Next Session */}
      <motion.div className="mb-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}>
        <p className="text-[13px] font-medium mb-2 px-1" style={{ color: 'var(--label-tertiary)' }}>Next Session</p>
        <div className="rounded-2xl p-4" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.07)' }}>
          {adjLines.length > 0 ? (
            <div className="space-y-2.5">
              {adjLines.map((line, i) => {
                const isIncrease = line.includes('increases');
                const isDecrease = line.includes('drops') || line.includes('deload');
                return (
                  <div key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0" style={{ color: isIncrease ? 'var(--tint-green)' : isDecrease ? 'var(--tint-orange)' : 'var(--label-tertiary)' }}>
                      {isIncrease ? <TrendingUp className="w-3.5 h-3.5" /> : isDecrease ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                    </span>
                    <span className="text-[14px] font-medium text-white">{line}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[14px] font-medium" style={{ color: 'var(--label-secondary)' }}>All loads stay the same — keep building.</p>
          )}
        </div>
      </motion.div>

      {/* Section 3: Big Picture — Progress Bars */}
      {progressBars.length > 0 && (
        <motion.div className="mb-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85 }}>
          <p className="text-[13px] font-medium mb-2 px-1" style={{ color: 'var(--label-tertiary)' }}>Programme Progress</p>
          <div className="rounded-2xl p-4 space-y-5" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.07)' }}>
            {progressBars.map((bar, i) => {
              const statusColorMap: Record<string, string> = {
                'On track': 'var(--tint-green)', 'Behind': 'var(--tint-orange)', 'Ahead': 'var(--tint-blue)'
              };
              const barColor = statusColorMap[bar.statusLabel] ?? 'var(--tint-blue)';
              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[15px] font-semibold text-white">{bar.name}</span>
                    <span className="text-[12px] font-medium" style={{ color: barColor }}>{bar.statusLabel}</span>
                  </div>
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-[13px] font-medium text-white tabular-nums w-14">{bar.current}kg</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#2c2c2e' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${bar.progress * 100}%` }}
                        transition={{ duration: 1.1, ease: 'easeOut', delay: 0.9 + i * 0.1 }}
                        className="h-full rounded-full"
                        style={{ background: barColor }}
                      />
                    </div>
                    <span className="text-[12px] text-right tabular-nums w-14" style={{ color: 'var(--label-tertiary)' }}>{bar.target}kg</span>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--label-quaternary)' }}>
                    {bar.current >= bar.target ? 'Week 8 target achieved' : `${(bar.target - bar.current).toFixed(1)}kg to go`}
                  </p>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* All Exercise Details */}
      <motion.div className="mb-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95 }}>
        <button
          onClick={() => setShowAllExercises(v => !v)}
          className="w-full flex items-center justify-between px-4 py-4 rounded-2xl transition-all list-row text-[14px] font-medium"
          style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--label-secondary)' }}
        >
          <span>{showAllExercises ? 'Hide details' : 'All exercises'}</span>
          <motion.div animate={{ rotate: showAllExercises ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--label-quaternary)' }} />
          </motion.div>
        </button>

        <AnimatePresence>
          {showAllExercises && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-2 rounded-2xl overflow-hidden" style={{ background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.07)' }}>
                {exerciseScores.length === 0 ? (
                  <div className="py-8 text-center text-[14px]" style={{ color: 'var(--label-tertiary)' }}>No weighted exercises logged.</div>
                ) : exerciseScores.map((es, i) => {
                  const statusColorByKey: Record<string, string> = {
                    exceeded: 'var(--tint-green)', on_target: 'var(--label-secondary)',
                    missed: 'var(--tint-orange)', no_data: 'var(--label-quaternary)',
                  };
                  const statusLabel = { exceeded: 'Exceeded', on_target: 'On Target', missed: 'Missed', no_data: '—' }[es.status];
                  const accentColor = statusColorByKey[es.status];
                  return (
                    <div key={i} className="px-4 py-3.5" style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[14px] font-semibold text-white">{es.name}</p>
                        <span className="text-[11px] font-medium" style={{ color: accentColor }}>{statusLabel}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        {[
                          { value: `${es.actualWeight}kg`, label: 'weight' },
                          { value: String(es.actualReps), label: 'reps' },
                          { value: String(es.actualSets), label: 'sets' },
                          { value: es.rpe.toFixed(1), label: 'rpe', color: accentColor },
                        ].map(stat => (
                          <div key={stat.label}>
                            <span className="block text-[17px] font-light text-white tabular-nums" style={stat.color ? { color: stat.color, letterSpacing: '-0.02em' } : { letterSpacing: '-0.02em' }}>
                              {stat.value}
                            </span>
                            <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: 'var(--label-quaternary)' }}>{stat.label}</span>
                          </div>
                        ))}
                      </div>
                      {es.prescribedWeight !== null && (
                        <p className="text-[11px] mt-1.5" style={{ color: 'var(--label-quaternary)' }}>
                          Target: {es.prescribedWeight}kg × {es.prescribedReps} reps × {es.prescribedSets} sets
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bottom-fade pointer-events-none" style={{ padding: '20px 16px max(env(safe-area-inset-bottom, 0px), 16px)' }}>
        <div className="max-w-2xl mx-auto pointer-events-auto space-y-2.5">
          <div className="w-full flex items-center justify-center gap-2 font-medium py-2.5 rounded-2xl text-[13px] transition-all"
            style={{
              background: savingStatus === 'saved' ? 'rgba(48,209,88,0.12)' : savingStatus === 'error' ? 'rgba(255,69,58,0.12)' : '#1c1c1e',
              color: savingStatus === 'saved' ? 'var(--tint-green)' : savingStatus === 'error' ? 'var(--tint-red)' : 'var(--label-quaternary)',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
            {savingStatus === 'saving' && <><RotateCcw className="w-3.5 h-3.5 animate-spin" />Saving...</>}
            {savingStatus === 'saved' && <><CheckCircle2 className="w-3.5 h-3.5" />Saved to device</>}
            {savingStatus === 'error' && <span>Save failed</span>}
            {savingStatus === 'idle' && <span>Saving...</span>}
          </div>

          <div className="flex gap-2.5">
            <button
              onClick={onICloudSave}
              disabled={iCloudStatus === 'saving' || iCloudStatus === 'saved'}
              className="flex-1 flex items-center justify-center gap-1.5 font-medium py-3.5 rounded-2xl text-[14px] transition-all active:scale-[0.97]"
              style={{
                background: iCloudStatus === 'saved' ? 'rgba(10,132,255,0.15)' : 'var(--tint-blue)',
                color: iCloudStatus === 'saved' ? 'var(--tint-blue)' : '#fff',
                opacity: iCloudStatus === 'saving' ? 0.6 : 1
              }}
            >
              {iCloudStatus === 'idle' && <><CloudUpload className="w-4 h-4" />iCloud</>}
              {iCloudStatus === 'saving' && <><RotateCcw className="w-4 h-4 animate-spin" />Saving</>}
              {iCloudStatus === 'saved' && <><CheckCircle2 className="w-4 h-4" />Saved</>}
              {iCloudStatus === 'share' && <><Share2 className="w-4 h-4" />Share</>}
            </button>

            <button
              onClick={onShareCSV}
              className="flex-1 flex items-center justify-center gap-1.5 font-medium py-3.5 rounded-2xl text-[14px] transition-all active:scale-[0.97]"
              style={{ background: '#2c2c2e', color: 'var(--label-secondary)' }}
            >
              {typeof navigator !== 'undefined' && navigator.share
                ? <><Share2 className="w-4 h-4" />CSV</>
                : <><Download className="w-4 h-4" />CSV</>}
            </button>

            <button
              onClick={handleDone}
              className="flex-[2] font-semibold py-3.5 rounded-2xl text-[15px] transition-all active:scale-[0.97]"
              style={{ background: 'var(--ring-exercise)', color: '#000' }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
