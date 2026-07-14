// Full-database JSON export/import. Hard rules: the API key must NEVER appear
// in an export (it lives in localStorage, not in any exported table), and
// import must not partially apply — it runs in a single transaction.

import { db } from './db';
import { format } from 'date-fns';
import { recordExport } from '../lib/backupNudge';

const TABLES = [
  'people',
  'recipes',
  'weekPlans',
  'feedback',
  'pantry',
  'grocery',
  'profiles',
  'settings',
] as const;

type TableName = (typeof TABLES)[number];

export interface BackupFile {
  app: 'family-meal-os';
  schemaVersion: 1;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const tables = {} as BackupFile['tables'];
  for (const name of TABLES) {
    tables[name] = await db.table(name).toArray();
  }
  return {
    app: 'family-meal-os',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

export function backupFilename(date: Date = new Date()): string {
  return `mealos-backup-${format(date, 'yyyy-MM-dd')}.json`;
}

export async function downloadBackup(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  a.click();
  URL.revokeObjectURL(url);
  recordExport();
}

export function validateBackup(data: unknown): { ok: true; backup: BackupFile } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'File is not a JSON object.' };
  }
  const d = data as Record<string, unknown>;
  if (d.app !== 'family-meal-os') {
    return { ok: false, error: 'This is not a Family Meal OS backup file.' };
  }
  if (d.schemaVersion !== 1) {
    return { ok: false, error: `Unsupported backup version: ${String(d.schemaVersion)}.` };
  }
  if (typeof d.tables !== 'object' || d.tables === null) {
    return { ok: false, error: 'Backup is missing its data tables.' };
  }
  const tables = d.tables as Record<string, unknown>;
  for (const name of TABLES) {
    if (!Array.isArray(tables[name])) {
      return { ok: false, error: `Backup is missing the "${name}" table.` };
    }
  }
  return { ok: true, backup: data as BackupFile };
}

/** Replaces the entire database with the backup contents, atomically. */
export async function importBackup(backup: BackupFile): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) {
      await db.table(name).clear();
      await db.table(name).bulkAdd(backup.tables[name]);
    }
  });
}
