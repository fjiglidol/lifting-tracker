/**
 * Vault — durable, per-profile storage that sits underneath the app rather
 * than inside it.
 *
 * Three reasons this exists instead of raw localStorage calls:
 *
 *  1. Per-user. Every key is namespaced by profile id, so two people (or a
 *     "real" and a "testing" profile) never read each other's numbers.
 *  2. Durable. iOS Safari evicts localStorage for sites unused for ~7 days.
 *     Every write is mirrored to IndexedDB, which is not subject to that
 *     sweep, and the mirror is restored on boot if localStorage came up empty.
 *  3. Portable. The whole profile exports to a single JSON file, so a training
 *     log can be backed up to Files/iCloud and restored on another device.
 *
 * This is not encryption — it is separation and survivability. Nothing here
 * leaves the device unless the user explicitly exports.
 */

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
}

const K_PROFILES = 'gsb_profiles';
const K_ACTIVE = 'gsb_active_profile';

const DB_NAME = 'gsb_vault';
const DB_STORE = 'kv';
const DB_VERSION = 1;

/** Domains the vault owns. Legacy flat keys migrate into these on first boot. */
export const VAULT_KEYS = {
  history: 'history',
  checkins: 'checkins',
  reassessments: 'reassessments',
  nutrition: 'nutrition',
  cycleStart: 'cycle_start',
  coaching: 'coaching',
} as const;

export type VaultKey = typeof VAULT_KEYS[keyof typeof VAULT_KEYS];

/** Pre-vault localStorage keys, mapped to their new home. */
const LEGACY_KEYS: Record<string, VaultKey> = {
  gsb_history: 'history',
  gsb_checkins: 'checkins',
  gsb_reassessments: 'reassessments',
  gsb_nutrition: 'nutrition',
  gsb_cycle_start: 'cycle_start',
  gsb_coaching_state: 'coaching',
};

// ─── Profiles ────────────────────────────────────────────────────────────────

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function listProfiles(): Profile[] {
  const stored = safeParse<Profile[]>(localStorage.getItem(K_PROFILES), []);
  if (stored.length > 0) return stored;
  const first: Profile = { id: 'default', name: 'Me', createdAt: new Date().toISOString() };
  localStorage.setItem(K_PROFILES, JSON.stringify([first]));
  return [first];
}

export function activeProfileId(): string {
  const id = localStorage.getItem(K_ACTIVE);
  const profiles = listProfiles();
  if (id && profiles.some(p => p.id === id)) return id;
  const fallback = profiles[0].id;
  localStorage.setItem(K_ACTIVE, fallback);
  return fallback;
}

export function activeProfile(): Profile {
  const id = activeProfileId();
  return listProfiles().find(p => p.id === id)!;
}

export function createProfile(name: string): Profile {
  const profile: Profile = { id: newId(), name: name.trim() || 'Unnamed', createdAt: new Date().toISOString() };
  const all = [...listProfiles(), profile];
  localStorage.setItem(K_PROFILES, JSON.stringify(all));
  return profile;
}

export function renameProfile(id: string, name: string) {
  const all = listProfiles().map(p => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
  localStorage.setItem(K_PROFILES, JSON.stringify(all));
}

export function switchProfile(id: string) {
  if (!listProfiles().some(p => p.id === id)) return;
  localStorage.setItem(K_ACTIVE, id);
}

// ─── Key namespacing ─────────────────────────────────────────────────────────

function nsKey(key: VaultKey, profileId = activeProfileId()): string {
  return `gsb:${profileId}:${key}`;
}

// ─── IndexedDB mirror ────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbSet(key: string, value: string) {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

// ─── Read / write ────────────────────────────────────────────────────────────

/**
 * Synchronous read from the localStorage tier. The IndexedDB mirror is only
 * consulted by restoreFromMirror() at boot, so reads stay fast and sync.
 */
export function read<T>(key: VaultKey, fallback: T, profileId?: string): T {
  return safeParse<T>(localStorage.getItem(nsKey(key, profileId)), fallback);
}

/** Writes through to localStorage and mirrors to IndexedDB (fire and forget). */
export function write(key: VaultKey, value: unknown, profileId?: string) {
  const k = nsKey(key, profileId);
  const raw = JSON.stringify(value);
  try { localStorage.setItem(k, raw); } catch {}
  void idbSet(k, raw);
}

/**
 * Boot step. Pulls anything the browser evicted from localStorage back out of
 * the IndexedDB mirror, and folds pre-vault flat keys into the active profile.
 * Returns true if anything was recovered or migrated.
 */
export async function hydrate(): Promise<boolean> {
  let changed = false;
  const pid = activeProfileId();

  // 1. Migrate legacy flat keys (one time, only when the namespaced slot is empty)
  for (const [legacy, key] of Object.entries(LEGACY_KEYS)) {
    const legacyRaw = localStorage.getItem(legacy);
    if (legacyRaw === null) continue;
    const target = nsKey(key, pid);
    if (localStorage.getItem(target) !== null) continue;
    try {
      localStorage.setItem(target, legacyRaw);
      void idbSet(target, legacyRaw);
      changed = true;
    } catch {}
  }

  // 2. Restore anything missing from the mirror
  for (const key of Object.values(VAULT_KEYS)) {
    const k = nsKey(key, pid);
    if (localStorage.getItem(k) !== null) continue;
    const mirrored = await idbGet(k);
    if (mirrored === null) continue;
    try {
      localStorage.setItem(k, mirrored);
      changed = true;
    } catch {}
  }

  return changed;
}

// ─── Export / import ─────────────────────────────────────────────────────────

export interface VaultExport {
  format: 'gsb-vault';
  version: 1;
  exportedAt: string;
  profile: Profile;
  data: Record<string, unknown>;
}

export function exportProfile(profileId = activeProfileId()): VaultExport {
  const profile = listProfiles().find(p => p.id === profileId) ?? activeProfile();
  const data: Record<string, unknown> = {};
  for (const key of Object.values(VAULT_KEYS)) {
    data[key] = read(key, null, profileId);
  }
  return {
    format: 'gsb-vault',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    data,
  };
}

export function exportFilename(profileId = activeProfileId()): string {
  const profile = listProfiles().find(p => p.id === profileId) ?? activeProfile();
  const slug = profile.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'profile';
  return `gsb-vault-${slug}-${new Date().toISOString().split('T')[0]}.json`;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  profileId?: string;
  keysRestored?: number;
}

/**
 * Restores an exported vault. Always lands in a NEW profile unless `merge` is
 * set — an import should never silently overwrite the log you are standing on.
 */
export function importProfile(raw: string, opts: { merge?: boolean } = {}): ImportResult {
  let parsed: VaultExport;
  try {
    parsed = JSON.parse(raw) as VaultExport;
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }
  if (parsed?.format !== 'gsb-vault' || !parsed.data) {
    return { ok: false, error: 'Not a vault export file.' };
  }

  const targetId = opts.merge
    ? activeProfileId()
    : createProfile(`${parsed.profile?.name ?? 'Imported'} (imported)`).id;

  let keysRestored = 0;
  for (const key of Object.values(VAULT_KEYS)) {
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    write(key, value, targetId);
    keysRestored++;
  }

  return { ok: true, profileId: targetId, keysRestored };
}

/** Triggers a download / share sheet for the profile backup. */
export async function downloadExport(profileId = activeProfileId()) {
  const json = JSON.stringify(exportProfile(profileId), null, 2);
  const filename = exportFilename(profileId);
  const file = new File([json], filename, { type: 'application/json' });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
