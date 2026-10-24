import type { ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'ok';

/**
 * Every status in this application reads as a word plus a shape. Colour is a
 * reinforcement, never the only signal.
 */
export function Chip({
  tone = 'neutral',
  glyph,
  children,
  title,
  mono,
}: {
  tone?: Tone;
  glyph?: string;
  children: ReactNode;
  title?: string;
  mono?: boolean;
}) {
  return (
    <span className={`chip ${tone}${mono ? ' mono' : ''}`} title={title}>
      {glyph ? (
        <span className="glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="alert error" role="alert">
      {message}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="card" aria-busy="true" aria-live="polite">
      <p className="meta">{label}</p>
      <div className="skeleton" style={{ width: '70%' }} />
      <div className="skeleton" style={{ width: '45%', marginTop: '0.5rem' }} />
      <div className="skeleton" style={{ width: '85%', marginTop: '0.5rem' }} />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint ? (
        <>
          <br />
          {hint}
        </>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={full ? 'full' : undefined}>
      <label>{label}</label>
      {children}
      {hint ? (
        <div className="meta" style={{ marginTop: '0.2rem' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
