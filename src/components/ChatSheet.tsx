// Reusable full-screen AI chat. Live mode sends to the API (one automatic
// retry on validation failure, mirroring the engine); Manual mode turns every
// exchange into the copy-prompt / paste-reply flow so the feature stays free.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { settingsRepo } from '../db/repo';
import { getApiKey } from '../lib/apiKey';
import { callClaude } from '../ai/client';
import type { ChatTurn } from '../ai/chat';
import { IconChevronRight, IconCopy, IconSparkles, IconX } from './Icons';

export interface ParsedChat<P> {
  reply: string;
  payload?: P;
}

interface Message<P> {
  role: 'user' | 'assistant';
  text: string;
  payload?: P;
}

interface ChatSheetProps<P> {
  title: string;
  intro: string;
  placeholder: string;
  suggestions: string[];
  buildPrompt: (history: ChatTurn[], userMessage: string) => Promise<string>;
  parseReply: (raw: string) => { ok: true; data: ParsedChat<P> } | { ok: false; error: string };
  /** Fired once when an assistant message carries a payload (e.g. auto-apply). */
  onPayload?: (payload: P) => Promise<void> | void;
  /** Rendered under an assistant message that carries a payload. */
  renderPayload?: (payload: P) => ReactNode;
  onClose: () => void;
}

export function ChatSheet<P>({
  title,
  intro,
  placeholder,
  suggestions,
  buildPrompt,
  parseReply,
  onPayload,
  renderPayload,
  onClose,
}: ChatSheetProps<P>) {
  const [messages, setMessages] = useState<Message<P>[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const settings = useLiveQuery(() => settingsRepo.get());
  const apiKey = getApiKey();
  const live = settings?.aiMode === 'live' && !!apiKey;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, manualPrompt, busy]);

  function history(): ChatTurn[] {
    return messages.map((m) => ({ role: m.role, text: m.text }));
  }

  async function acceptReply(raw: string): Promise<{ ok: boolean; error?: string }> {
    const parsed = parseReply(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const { reply, payload } = parsed.data;
    if (payload !== undefined && onPayload) await onPayload(payload);
    setMessages((m) => [...m, { role: 'assistant', text: reply, payload }]);
    return { ok: true };
  }

  async function send(text: string) {
    const userMessage = text.trim();
    if (!userMessage || busy || manualPrompt) return;
    setError('');
    setInput('');
    const h = history();
    setMessages((m) => [...m, { role: 'user', text: userMessage }]);
    const prompt = await buildPrompt(h, userMessage);

    if (!live) {
      setManualPrompt(prompt);
      return;
    }

    setBusy(true);
    try {
      let raw = await callClaude(prompt, apiKey!);
      let result = await acceptReply(raw);
      if (!result.ok) {
        raw = await callClaude(
          `${prompt}\n\nYour previous reply failed validation with this error:\n${result.error}\nReturn the corrected strict JSON only.`,
          apiKey!
        );
        result = await acceptReply(raw);
        if (!result.ok) setError(`Claude's reply didn't validate: ${result.error}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function importManualReply() {
    setError('');
    const result = await acceptReply(pasted);
    if (!result.ok) {
      setError(`Paste didn't parse — make sure you copied Claude's entire reply. (${result.error})`);
      return;
    }
    setManualPrompt(null);
    setPasted('');
  }

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col bg-cream">
      {/* header */}
      <header className="flex items-center justify-between border-b border-line px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <h1 className="flex items-center gap-2 font-display text-lg">
          <IconSparkles size={18} className="text-primary" /> {title}
        </h1>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-mist text-ink-soft"
        >
          <IconX size={20} />
        </button>
      </header>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <div>
              <p className="mb-3 text-sm text-ink-soft">{intro}</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="min-h-11 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-left text-sm font-semibold text-secondary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-on-strong'
                    : 'max-w-[90%] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-sm'
                }
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.payload !== undefined && renderPayload && <div className="mt-2">{renderPayload(m.payload)}</div>}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <IconSparkles size={16} className="animate-pulse text-primary" /> Thinking…
            </div>
          )}

          {/* Manual mode exchange */}
          {manualPrompt && (
            <div className="rounded-2xl border border-line bg-surface p-3">
              <p className="mb-2 text-sm font-semibold">Free mode: run this through claude.ai</p>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(manualPrompt);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }}
                className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-secondary font-semibold text-on-strong"
              >
                <IconCopy size={16} /> {copied ? 'Copied!' : 'Copy prompt'}
              </button>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Paste Claude's reply here…"
                rows={4}
                className="mt-2 w-full rounded-xl border border-line bg-cream p-2.5 font-mono text-xs"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void importManualReply()}
                  disabled={!pasted.trim()}
                  className="min-h-11 flex-1 cursor-pointer rounded-xl bg-primary font-semibold text-on-strong disabled:opacity-40"
                >
                  Import reply
                </button>
                <button
                  onClick={() => {
                    setManualPrompt(null);
                    setPasted('');
                    setMessages((m) => m.slice(0, -1)); // withdraw the unanswered question
                  }}
                  className="min-h-11 cursor-pointer rounded-xl border border-line px-3 font-semibold text-ink-soft"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm font-semibold text-danger">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* input */}
      <footer className="border-t border-line px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send(input)}
            placeholder={placeholder}
            disabled={busy || !!manualPrompt}
            className="min-h-12 flex-1 rounded-2xl border border-line bg-surface px-4"
          />
          <button
            onClick={() => void send(input)}
            disabled={!input.trim() || busy || !!manualPrompt}
            aria-label="Send"
            className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-primary text-on-strong disabled:opacity-40"
          >
            <IconChevronRight size={22} />
          </button>
        </div>
      </footer>
    </div>
  );
}
