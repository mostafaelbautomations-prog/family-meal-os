import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, Screen } from '../components/Screen';
import { peopleRepo, profilesRepo, settingsRepo } from '../db/repo';
import { downloadBackup, importBackup, validateBackup } from '../db/backup';
import { clearApiKey, getApiKey, maskApiKey, setApiKey } from '../lib/apiKey';
import { notificationsSupported, requestNotificationPermission } from '../lib/notify';
import { lastExportAt } from '../lib/backupNudge';
import { testConnection } from '../ai/client';
import type { Person, PersonProfile } from '../types';
import { IconDownload, IconEye, IconEyeOff, IconUpload } from '../components/Icons';

export function SettingsScreen() {
  const people = useLiveQuery(() => peopleRepo.all());
  const settings = useLiveQuery(() => settingsRepo.get());
  const profiles = useLiveQuery(() => profilesRepo.all());

  return (
    <Screen title="Settings">
      <div className="flex flex-col gap-4">
        <PeopleSection people={people ?? []} />
        {settings && <ServeTimesSection settings={settings} />}
        {settings && <AiSection aiMode={settings.aiMode} />}
        {settings && <NotificationsSection enabled={settings.notificationsEnabled} />}
        <ProfilesSection people={(people ?? []).filter((p) => p.active)} profiles={profiles ?? []} />
        <BackupSection />
      </div>
    </Screen>
  );
}

// --- Notifications ------------------------------------------------------------

function NotificationsSection({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState('');

  async function toggle(next: boolean) {
    setError('');
    if (next) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setError("Your browser didn't allow notifications. The Today view still shows every reminder.");
        return;
      }
    }
    await settingsRepo.update({ notificationsEnabled: next });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg">Prep reminders</h2>
          <p className="text-xs text-ink-soft">
            Pings for defrost/marinate steps while the app is open. The Today view is the reliable
            reminder.
          </p>
        </div>
        <label className="relative ml-3 inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!notificationsSupported()}
            onChange={(e) => void toggle(e.target.checked)}
            className="peer sr-only"
          />
          <span className="h-7 w-12 rounded-full bg-line transition-colors peer-checked:bg-accent after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>
      {!notificationsSupported() && (
        <p className="mt-2 text-xs text-ink-soft">Not supported in this browser.</p>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
    </Card>
  );
}

// --- Preference profiles (what the engine has learned) --------------------------

function ProfilesSection({ people, profiles }: { people: Person[]; profiles: PersonProfile[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Card>
      <h2 className="mb-1 font-display text-lg">Taste profiles</h2>
      <p className="mb-3 text-xs text-ink-soft">What the planner has learned. Correct it if it's wrong.</p>
      <div className="flex flex-col gap-3">
        {people.map((person) => {
          const profile = profiles.find((p) => p.personId === person.id) ?? {
            personId: person.id,
            likes: [],
            dislikes: [],
            patterns: [],
            lastUpdated: '',
          };
          return editing === person.id ? (
            <ProfileEditor
              key={person.id}
              person={person}
              profile={profile}
              onDone={() => setEditing(null)}
            />
          ) : (
            <div key={person.id} className="rounded-xl bg-mist p-3">
              <div className="flex items-center justify-between">
                <p className="font-bold">{person.name}</p>
                <button
                  onClick={() => setEditing(person.id)}
                  className="min-h-11 cursor-pointer px-2 text-sm font-bold text-primary"
                >
                  Correct this
                </button>
              </div>
              <ProfileLine label="Likes" items={profile.likes} />
              <ProfileLine label="Dislikes" items={profile.dislikes} />
              <ProfileLine label="Patterns" items={profile.patterns} />
              <ProfileLine label="Kitchen notes" items={profile.notes ?? []} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ProfileLine({ label, items }: { label: string; items: string[] }) {
  return (
    <p className="mt-1 text-sm">
      <span className="font-semibold text-ink-soft">{label}:</span>{' '}
      {items.length ? items.join(', ') : <span className="text-ink-soft">nothing yet</span>}
    </p>
  );
}

function ProfileEditor({
  person,
  profile,
  onDone,
}: {
  person: Person;
  profile: PersonProfile;
  onDone: () => void;
}) {
  const [likes, setLikes] = useState(profile.likes.join(', '));
  const [dislikes, setDislikes] = useState(profile.dislikes.join(', '));
  const [patterns, setPatterns] = useState(profile.patterns.join(', '));
  const [notes, setNotes] = useState((profile.notes ?? []).join('\n'));

  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function save() {
    await profilesRepo.put({
      personId: person.id,
      likes: split(likes),
      dislikes: split(dislikes),
      patterns: split(patterns),
      notes: notes.split('\n').map((x) => x.trim()).filter(Boolean),
      lastUpdated: new Date().toISOString(),
    });
    onDone();
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-surface p-3">
      <p className="mb-2 font-bold">{person.name}</p>
      {(
        [
          ['Likes', likes, setLikes],
          ['Dislikes', dislikes, setDislikes],
          ['Patterns', patterns, setPatterns],
        ] as const
      ).map(([label, value, set]) => (
        <label key={label} className="mb-2 block text-sm">
          <span className="font-semibold text-ink-soft">{label} (comma-separated)</span>
          <input
            value={value}
            onChange={(e) => set(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-3"
          />
        </label>
      ))}
      <label className="mb-2 block text-sm">
        <span className="font-semibold text-ink-soft">Kitchen notes — rules the AI always follows (one per line)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={'e.g. plate his portion before mixing in the vegetables'}
          className="mt-1 w-full rounded-lg border border-line bg-surface p-3"
        />
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => void save()}
          className="min-h-11 flex-1 cursor-pointer rounded-lg bg-primary font-semibold text-on-strong"
        >
          Save
        </button>
        <button
          onClick={onDone}
          className="min-h-11 flex-1 cursor-pointer rounded-lg border border-line font-semibold text-ink-soft"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- People ------------------------------------------------------------------

function PeopleSection({ people }: { people: { id: string; name: string; active: boolean }[] }) {
  return (
    <Card>
      <h2 className="mb-2 font-display text-lg">Family</h2>
      <ul className="flex flex-col divide-y divide-line">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <input
              defaultValue={p.name}
              aria-label={`Name for ${p.name}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== p.name) void peopleRepo.rename(p.id, v);
                else e.target.value = p.name;
              }}
              className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-3 font-semibold"
            />
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={p.active}
                onChange={(e) => void peopleRepo.setActive(p.id, e.target.checked)}
                className="h-5 w-5 accent-[--color-primary]"
              />
              Eating
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-soft">
        Untick someone who's away — they'll be skipped when logging meals.
      </p>
    </Card>
  );
}

// --- Serve times ---------------------------------------------------------------

function ServeTimesSection({
  settings,
}: {
  settings: {
    defaultServeTimeWeekday: string;
    defaultServeTimeWeekend: [string, string];
    defaultSnackTime: string;
  };
}) {
  return (
    <Card>
      <h2 className="mb-2 font-display text-lg">Default serve times</h2>
      <div className="flex flex-col gap-3">
        <TimeRow
          label="Weekday main"
          value={settings.defaultServeTimeWeekday}
          onChange={(v) => void settingsRepo.update({ defaultServeTimeWeekday: v })}
        />
        <TimeRow
          label="Weekday snack"
          value={settings.defaultSnackTime}
          onChange={(v) => void settingsRepo.update({ defaultSnackTime: v })}
        />
        <TimeRow
          label="Weekend meal 1"
          value={settings.defaultServeTimeWeekend[0]}
          onChange={(v) =>
            void settingsRepo.update({
              defaultServeTimeWeekend: [v, settings.defaultServeTimeWeekend[1]],
            })
          }
        />
        <TimeRow
          label="Weekend meal 2"
          value={settings.defaultServeTimeWeekend[1]}
          onChange={(v) =>
            void settingsRepo.update({
              defaultServeTimeWeekend: [settings.defaultServeTimeWeekend[0], v],
            })
          }
        />
      </div>
      <p className="mt-2 text-xs text-ink-soft">New plans use these; each day stays adjustable.</p>
    </Card>
  );
}

function TimeRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="font-semibold">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-line bg-surface px-3"
      />
    </label>
  );
}

// --- AI mode + key ----------------------------------------------------------------

function AiSection({ aiMode }: { aiMode: 'live' | 'manual' }) {
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const [testError, setTestError] = useState('');
  const storedKey = getApiKey();

  async function runTest() {
    if (!storedKey) return;
    setTestState('testing');
    setTestError('');
    const result = await testConnection(storedKey);
    if (result.ok) setTestState('ok');
    else {
      setTestState('failed');
      setTestError(result.error);
    }
  }

  return (
    <Card>
      <h2 className="mb-2 font-display text-lg">AI planning</h2>
      <div className="mb-3 flex rounded-xl bg-mist p-1" role="radiogroup" aria-label="AI mode">
        {(['manual', 'live'] as const).map((mode) => (
          <button
            key={mode}
            role="radio"
            aria-checked={aiMode === mode}
            onClick={() => void settingsRepo.update({ aiMode: mode })}
            className={`min-h-11 flex-1 cursor-pointer rounded-lg font-semibold transition-colors ${
              aiMode === mode ? 'bg-surface text-primary shadow-sm' : 'text-ink-soft'
            }`}
          >
            {mode === 'manual' ? 'Copy/paste (free)' : 'Instant (API key)'}
          </button>
        ))}
      </div>

      {aiMode === 'manual' ? (
        <p className="text-sm text-ink-soft">
          Free fallback: AI features work by copying a prompt into claude.ai and pasting the reply
          back. Switch to Live and add a key for instant, in-app AI.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {storedKey && (
            <p className="text-sm">
              Saved key: <span className="font-mono">{maskApiKey(storedKey)}</span>{' '}
              <button
                onClick={() => {
                  clearApiKey();
                  setKeyDraft('');
                  setSavedTick(false);
                }}
                className="ml-2 min-h-11 cursor-pointer font-semibold text-danger"
              >
                Remove
              </button>
            </p>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
                aria-label="Anthropic API key"
                className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 pr-11 font-mono text-sm"
              />
              <button
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
                className="absolute top-0 right-0 flex h-full w-11 cursor-pointer items-center justify-center text-ink-soft"
              >
                {showKey ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
            <button
              disabled={!keyDraft.trim()}
              onClick={() => {
                setApiKey(keyDraft);
                setKeyDraft('');
                setSavedTick(true);
                void settingsRepo.update({ aiMode: 'live' }); // key saved → instant mode on
              }}
              className="min-h-11 cursor-pointer rounded-lg bg-primary px-4 font-semibold text-on-strong disabled:opacity-40"
            >
              Save
            </button>
          </div>
          {savedTick && <p className="text-sm font-semibold text-accent">Key saved on this device.</p>}
          {storedKey && (
            <button
              onClick={() => void runTest()}
              disabled={testState === 'testing'}
              className="min-h-11 cursor-pointer rounded-lg border border-line font-semibold text-secondary disabled:opacity-50"
            >
              {testState === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
          )}
          {testState === 'ok' && <p className="text-sm font-semibold text-accent">Connection works.</p>}
          {testState === 'failed' && <p className="text-sm font-semibold text-danger">{testError}</p>}
          <p className="text-xs text-ink-soft">
            Your key lives only on this device. Anyone with your unlocked phone can read it. Use a key
            with a low spend limit.
          </p>
        </div>
      )}
    </Card>
  );
}

// --- Backup -------------------------------------------------------------------------

function BackupSection() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = validateBackup(parsed);
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      if (!confirm('Importing replaces ALL current data with the backup. Continue?')) return;
      await importBackup(result.backup);
      setMessage({ kind: 'ok', text: 'Backup restored.' });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof SyntaxError ? "That file isn't valid JSON." : 'Import failed — data unchanged.',
      });
    }
  }

  const last = lastExportAt();
  return (
    <Card>
      <h2 className="mb-2 font-display text-lg">Backup</h2>
      <p className="mb-1 text-sm text-ink-soft">
        Your data lives only in this browser. Export a backup weekly — the browser can evict it.
      </p>
      <p className="mb-3 text-xs font-semibold text-ink-soft">
        Last export: {last ? last.toLocaleDateString() : 'never'}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => void downloadBackup()}
          className="flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-on-strong"
        >
          <IconDownload size={18} /> Export
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          className="flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-primary font-semibold text-primary"
        >
          <IconUpload size={18} /> Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {message && (
        <p className={`mt-2 text-sm font-semibold ${message.kind === 'ok' ? 'text-accent' : 'text-danger'}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}
