import { useEffect, useState } from 'react';
import type { AiSummary, Athlete, Audience, Update } from '../../shared/types.js';
import { DEPARTMENT_LABELS } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { Chip, ErrorBox, Loading, formatDate, formatDateTime } from './Bits.js';

/**
 * Shows the updates an item was built from. Sources are fetched by id through
 * the same authorized endpoint the list uses, so a link to a record outside the
 * reader's audience returns nothing rather than a preview.
 */
export function SourceDrawer({
  sourceIds,
  summaries,
  athletes,
  audiences,
  staffNames,
  onClose,
}: {
  sourceIds: string[];
  summaries: AiSummary[];
  athletes: Map<string, Athlete>;
  audiences: Map<string, Audience>;
  staffNames: Map<string, string>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Update[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    Promise.all(sourceIds.map((id) => api.update(id).catch(() => null)))
      .then((results) => {
        if (!live) return;
        setRows(results.filter((r): r is Update => r !== null));
      })
      .catch((err: ApiError) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [sourceIds.join(',')]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Source updates"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>Source updates</h2>
          <button className="subtle" onClick={onClose} aria-label="Close sources">
            Close
          </button>
        </div>
        <p className="meta" style={{ marginBottom: '0.75rem' }}>
          Everything below is what a person wrote. Model output is labelled separately.
        </p>

        {error ? <ErrorBox message={error} /> : null}
        {rows === null ? <Loading label="Loading sources" /> : null}
        {rows?.length === 0 ? (
          <div className="empty">
            <strong>No readable sources</strong>
            <br />
            These sources are outside the audiences you belong to.
          </div>
        ) : null}

        {rows?.map((u) => {
          const summary = summaries.find((s) => s.sourceUpdateId === u.id);
          const audience = audiences.get(u.audienceId);
          return (
            <div className="card" key={u.id}>
              <div className="card-head">
                <Chip mono>{u.id}</Chip>
                <Chip>{DEPARTMENT_LABELS[u.department]}</Chip>
                <Chip tone={audience?.sensitive ? 'danger' : 'neutral'} glyph={audience?.sensitive ? '!' : undefined}>
                  {audience?.name ?? u.audienceId}
                </Chip>
                {u.status === 'withdrawn' ? (
                  <Chip tone="danger" glyph="x">
                    Withdrawn
                  </Chip>
                ) : null}
              </div>
              <div className="meta" style={{ marginTop: '0.4rem' }}>
                <span>{athletes.get(u.athleteId)?.name ?? u.athleteId}</span>
                <span className="dot">{staffNames.get(u.authorId) ?? u.authorId}</span>
                <span className="dot">{formatDateTime(u.createdAt)}</span>
                <span className="dot">Review by {formatDate(u.reviewDate)}</span>
              </div>
              <p className="body-text">{u.body}</p>
              {u.plannedBlock ? (
                <div className="meta">
                  Books {u.plannedBlock.label} on {formatDate(u.plannedBlock.date)}, {u.plannedBlock.start}–
                  {u.plannedBlock.end}
                </div>
              ) : null}
              {u.requestedAction ? (
                <div className="meta">
                  Requested action: {u.requestedAction} —{' '}
                  {u.requestedActionOwnerId ? (
                    (staffNames.get(u.requestedActionOwnerId) ?? u.requestedActionOwnerId)
                  ) : (
                    <Chip tone="warn" glyph="!">
                      No owner
                    </Chip>
                  )}
                </div>
              ) : null}
              {u.revisions.length > 0 ? (
                <details style={{ marginTop: '0.5rem' }}>
                  <summary className="meta">
                    {u.revisions.length} revision{u.revisions.length === 1 ? '' : 's'}
                  </summary>
                  {u.revisions.map((r, i) => (
                    <div className="meta" key={i} style={{ marginTop: '0.35rem' }}>
                      {formatDateTime(r.revisedAt)} — {staffNames.get(r.revisedBy) ?? r.revisedBy}: {r.note}
                    </div>
                  ))}
                </details>
              ) : null}
              {summary ? (
                <div className="alert warn" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
                  <strong>Model summary, not a fact.</strong> {summary.summary}
                </div>
              ) : null}
            </div>
          );
        })}
      </aside>
    </div>
  );
}
