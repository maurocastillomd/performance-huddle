import { useCallback, useEffect, useState } from 'react';
import type { Decision, SessionInfo } from '../../shared/types.js';
import type { Reference } from '../App.js';
import { api } from '../api.js';
import { Chip, EmptyState, ErrorBox, Loading, formatDate, formatDateTime } from '../components/Bits.js';
import { SourceDrawer } from '../components/SourceDrawer.js';

const STATUS: Record<Decision['status'], { label: string; tone: 'ok' | 'accent' | 'neutral'; glyph: string }> = {
  open: { label: 'Open', tone: 'accent', glyph: '•' },
  completed: { label: 'Completed', tone: 'ok', glyph: '✓' },
  superseded: { label: 'Superseded', tone: 'neutral', glyph: '»' },
};

export function DecisionsScreen({ session, reference }: { session: SessionInfo; reference: Reference }) {
  const [rows, setRows] = useState<Decision[] | null>(null);
  const [filter, setFilter] = useState<'all' | Decision['status']>('all');
  const [error, setError] = useState<string | null>(null);
  const [drawerSources, setDrawerSources] = useState<string[] | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  const canApprove = session.user.permissions.includes('approve');

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.decisions());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (id: string, ownerId: string): Promise<void> => {
    setError(null);
    try {
      await api.patchDecision(id, { ownerId: ownerId || null });
      setAssigning(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const complete = async (id: string): Promise<void> => {
    setError(null);
    try {
      await api.patchDecision(id, { status: 'completed' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const visible = rows?.filter((d) => filter === 'all' || d.status === filter) ?? null;
  const unowned = rows?.filter((d) => d.status === 'open' && !d.ownerId).length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Decisions</h1>
          <p>
            What was agreed, who owns it, why, when it is due, and when it gets looked at again. Superseded decisions
            stay on the record rather than disappearing.
          </p>
        </div>
        <div className="actions">
          <label className="sr-only" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            style={{ width: 'auto' }}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="superseded">Superseded</option>
          </select>
        </div>
      </div>

      {unowned > 0 ? (
        <div className="alert warn">
          {unowned} open decision{unowned === 1 ? '' : 's'} with nobody assigned. The next brief will keep raising
          {unowned === 1 ? ' it' : ' them'}.
        </div>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}

      {visible === null ? <Loading label="Loading decisions" /> : null}
      {visible?.length === 0 ? <EmptyState title="No decisions match this filter" /> : null}

      {visible?.map((d) => {
        const status = STATUS[d.status];
        const athlete = d.athleteId ? reference.athletes.get(d.athleteId) : null;
        const overdue = d.status === 'open' && d.dueDate && d.dueDate < new Date().toISOString().slice(0, 10);
        return (
          <div className="card" key={d.id}>
            <div className="card-head">
              <Chip mono>{d.id}</Chip>
              <strong>{d.action}</strong>
              <div className="spacer" />
              <Chip tone={status.tone} glyph={status.glyph}>
                {status.label}
              </Chip>
              {overdue ? (
                <Chip tone="warn" glyph="!">
                  Past due
                </Chip>
              ) : null}
            </div>

            <div className="meta" style={{ marginTop: '0.45rem' }}>
              {athlete ? <span>{athlete.name}</span> : <span>No athlete named</span>}
              <span className="dot">{reference.audiences.get(d.audienceId)?.name ?? d.audienceId}</span>
              {d.dueDate ? <span className="dot">Due {formatDate(d.dueDate)}</span> : null}
              {d.reviewDate ? <span className="dot">Review {formatDate(d.reviewDate)}</span> : null}
              <span className="dot">Recorded {formatDateTime(d.createdAt)}</span>
            </div>

            <p className="body-text">{d.rationale}</p>

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {d.ownerId ? (
                <Chip tone="ok" glyph="@">
                  Owner: {reference.staffNames.get(d.ownerId) ?? d.ownerId}
                </Chip>
              ) : (
                <Chip tone="warn" glyph="!">
                  No owner assigned
                </Chip>
              )}
              {d.supersedesDecisionId ? <Chip glyph="»">Replaces {d.supersedesDecisionId}</Chip> : null}
              {d.supersededByDecisionId ? <Chip glyph="»">Replaced by {d.supersededByDecisionId}</Chip> : null}
              {d.sourceUpdateIds.length > 0 ? (
                <button className="chip" onClick={() => setDrawerSources(d.sourceUpdateIds)}>
                  Sources: {d.sourceUpdateIds.join(', ')}
                </button>
              ) : (
                <Chip>No linked sources</Chip>
              )}
              {d.briefId ? <Chip mono>From {d.briefId}</Chip> : null}
            </div>

            {assigning === d.id ? (
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                <select
                  defaultValue=""
                  style={{ width: 'auto', minWidth: '220px' }}
                  onChange={(e) => void assign(d.id, e.target.value)}
                  aria-label={`Assign an owner to ${d.id}`}
                >
                  <option value="">Choose an owner</option>
                  {reference.staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.title}
                    </option>
                  ))}
                </select>
                <button className="small" onClick={() => setAssigning(null)}>
                  Cancel
                </button>
              </div>
            ) : null}

            {canApprove && d.status === 'open' && assigning !== d.id ? (
              <div className="item-actions">
                <button className="small" onClick={() => setAssigning(d.id)}>
                  {d.ownerId ? 'Change owner' : 'Assign owner'}
                </button>
                <button className="small" onClick={() => void complete(d.id)}>
                  Mark completed
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      {drawerSources ? (
        <SourceDrawer
          sourceIds={drawerSources}
          summaries={[]}
          athletes={reference.athletes}
          audiences={reference.audiences}
          staffNames={reference.staffNames}
          onClose={() => setDrawerSources(null)}
        />
      ) : null}
    </>
  );
}
