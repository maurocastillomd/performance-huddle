import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionInfo, Update } from '../../shared/types.js';
import { DEPARTMENT_LABELS } from '../../shared/types.js';
import type { Reference } from '../App.js';
import { api } from '../api.js';
import { Chip, EmptyState, ErrorBox, Field, Loading, formatDate, formatDateTime } from '../components/Bits.js';

const DEPARTMENTS = Object.keys(DEPARTMENT_LABELS) as (keyof typeof DEPARTMENT_LABELS)[];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

interface FormState {
  athleteId: string;
  department: string;
  audienceId: string;
  body: string;
  requestedAction: string;
  requestedActionOwnerId: string;
  reviewDate: string;
  withBlock: boolean;
  blockDate: string;
  blockStart: string;
  blockEnd: string;
  blockLabel: string;
}

export function UpdatesScreen({ session, reference }: { session: SessionInfo; reference: Reference }) {
  const [rows, setRows] = useState<Update[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audienceFilter, setAudienceFilter] = useState('');
  const [athleteFilter, setAthleteFilter] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSubmit = session.user.permissions.includes('submit');
  const defaultAudience = session.user.audiences[0]?.id ?? '';

  const [form, setForm] = useState<FormState>({
    athleteId: '',
    department: session.user.department,
    audienceId: defaultAudience,
    body: '',
    requestedAction: '',
    requestedActionOwnerId: '',
    reviewDate: addDays(todayIso(), 7),
    withBlock: false,
    blockDate: todayIso(),
    blockStart: '14:00',
    blockEnd: '15:00',
    blockLabel: '',
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.updates({ audienceId: audienceFilter || undefined, athleteId: athleteFilter || undefined }));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [audienceFilter, athleteFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (q.length < 2) return rows;
    return rows.filter(
      (u) =>
        u.body.toLowerCase().includes(q) ||
        (reference.athletes.get(u.athleteId)?.name ?? '').toLowerCase().includes(q),
    );
  }, [rows, query, reference]);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createUpdate({
        athleteId: form.athleteId,
        department: form.department,
        audienceId: form.audienceId,
        body: form.body,
        requestedAction: form.requestedAction.trim() || null,
        requestedActionOwnerId: form.requestedActionOwnerId || null,
        reviewDate: form.reviewDate,
        plannedBlock: form.withBlock
          ? { date: form.blockDate, start: form.blockStart, end: form.blockEnd, label: form.blockLabel }
          : null,
      });
      setNotice(`Update ${created.id} submitted to ${reference.audiences.get(created.audienceId)?.name ?? ''}.`);
      setShowForm(false);
      setForm({ ...form, body: '', requestedAction: '', requestedActionOwnerId: '', withBlock: false, blockLabel: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const formValid = form.athleteId && form.audienceId && form.body.trim().length > 0 && form.reviewDate;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Updates</h1>
          <p>
            What each department wants the rest of the group to know today. Every update names one audience, and it
            never leaves it.
          </p>
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={() => setShowForm((s) => !s)}
            disabled={!canSubmit}
            title={canSubmit ? undefined : 'Your staff record does not carry submit permission.'}
          >
            {showForm ? 'Cancel' : 'New update'}
          </button>
        </div>
      </div>

      {!canSubmit ? (
        <div className="alert info">
          You can read the audiences you belong to. Submitting is a separate permission your record does not carry.
        </div>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      {notice ? <div className="alert info">{notice}</div> : null}

      {showForm ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '0.7rem' }}>New update</h3>
          <div className="form-grid">
            <Field label="Athlete">
              <select value={form.athleteId} onChange={(e) => setForm({ ...form, athleteId: e.target.value })}>
                <option value="">Choose an athlete</option>
                {reference.athleteList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.position} #{a.jersey}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Audience" hint="Only groups you belong to. This is the boundary for everything downstream.">
              <select value={form.audienceId} onChange={(e) => setForm({ ...form, audienceId: e.target.value })}>
                {session.user.audiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.sensitive ? ' (restricted)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Review date" hint="After this date the brief marks the guidance stale.">
              <input type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} />
            </Field>
            <Field label="Operational update" full>
              <textarea
                value={form.body}
                placeholder="What happened, and what the rest of the group needs to know."
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </Field>
            <Field label="Requested action" hint="Leave empty if nothing is being asked for.">
              <input value={form.requestedAction} onChange={(e) => setForm({ ...form, requestedAction: e.target.value })} />
            </Field>
            <Field label="Action owner" hint="Leave unassigned to see how the brief surfaces it.">
              <select
                value={form.requestedActionOwnerId}
                onChange={(e) => setForm({ ...form, requestedActionOwnerId: e.target.value })}
              >
                <option value="">Nobody yet</option>
                {reference.staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="full">
              <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={form.withBlock}
                  onChange={(e) => setForm({ ...form, withBlock: e.target.checked })}
                />
                This update books time with the athlete
              </label>
            </div>
            {form.withBlock ? (
              <>
                <Field label="Block date">
                  <input type="date" value={form.blockDate} onChange={(e) => setForm({ ...form, blockDate: e.target.value })} />
                </Field>
                <Field label="Label">
                  <input
                    value={form.blockLabel}
                    placeholder="Lower-body lift, weight room"
                    onChange={(e) => setForm({ ...form, blockLabel: e.target.value })}
                  />
                </Field>
                <Field label="Start">
                  <input type="time" value={form.blockStart} onChange={(e) => setForm({ ...form, blockStart: e.target.value })} />
                </Field>
                <Field label="End">
                  <input type="time" value={form.blockEnd} onChange={(e) => setForm({ ...form, blockEnd: e.target.value })} />
                </Field>
              </>
            ) : null}
          </div>
          <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem' }}>
            <button className="primary" onClick={() => void submit()} disabled={!formValid || saving}>
              {saving ? 'Submitting...' : 'Submit update'}
            </button>
            <button onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: '0.75rem' }}>
        <div className="form-grid">
          <Field label="Audience">
            <select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)}>
              <option value="">All audiences you belong to</option>
              {session.user.audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Athlete">
            <select value={athleteFilter} onChange={(e) => setAthleteFilter(e.target.value)}>
              <option value="">Whole roster</option>
              {reference.athleteList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search text" full>
            <input value={query} placeholder="Type at least two characters" onChange={(e) => setQuery(e.target.value)} />
          </Field>
        </div>
      </div>

      {visible === null ? <Loading label="Loading updates" /> : null}
      {visible?.length === 0 ? (
        <EmptyState title="No updates match" hint="Widen the filters, or submit the first update of the day." />
      ) : null}

      {visible?.map((u) => {
        const audience = reference.audiences.get(u.audienceId);
        const athlete = reference.athletes.get(u.athleteId);
        const stale = u.reviewDate < todayIso();
        return (
          <div className="card" key={u.id}>
            <div className="card-head">
              <Chip mono>{u.id}</Chip>
              <strong>{athlete ? `${athlete.name} · ${athlete.position} #${athlete.jersey}` : u.athleteId}</strong>
              <Chip>{DEPARTMENT_LABELS[u.department]}</Chip>
              <Chip tone={audience?.sensitive ? 'danger' : 'neutral'} glyph={audience?.sensitive ? '!' : undefined}>
                {audience?.name ?? u.audienceId}
              </Chip>
              {stale ? (
                <Chip tone="warn" glyph="!">
                  Past review date
                </Chip>
              ) : null}
              {u.supersedesUpdateId ? (
                <Chip tone="accent" glyph="»">
                  Replaces {u.supersedesUpdateId}
                </Chip>
              ) : null}
              {u.status === 'withdrawn' ? (
                <Chip tone="danger" glyph="x">
                  Withdrawn
                </Chip>
              ) : null}
            </div>
            <p className="body-text">{u.body}</p>
            {u.plannedBlock ? (
              <div className="meta">
                Books {u.plannedBlock.label} on {formatDate(u.plannedBlock.date)}, {u.plannedBlock.start}–
                {u.plannedBlock.end}
              </div>
            ) : null}
            {u.requestedAction ? (
              <div className="meta" style={{ marginTop: '0.35rem' }}>
                Requested action: {u.requestedAction} —{' '}
                {u.requestedActionOwnerId ? (
                  (reference.staffNames.get(u.requestedActionOwnerId) ?? u.requestedActionOwnerId)
                ) : (
                  <Chip tone="warn" glyph="!">
                    No owner
                  </Chip>
                )}
              </div>
            ) : null}
            <div className="meta" style={{ marginTop: '0.45rem' }}>
              <span>{reference.staffNames.get(u.authorId) ?? u.authorId}</span>
              <span className="dot">{formatDateTime(u.createdAt)}</span>
              <span className="dot">Review by {formatDate(u.reviewDate)}</span>
              {u.revisions.length > 0 ? (
                <span className="dot">
                  {u.revisions.length} revision{u.revisions.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            {u.revisions.length > 0 ? (
              <details style={{ marginTop: '0.4rem' }}>
                <summary className="meta">Revision history</summary>
                {u.revisions.map((r, i) => (
                  <div className="meta" key={i} style={{ marginTop: '0.3rem' }}>
                    {formatDateTime(r.revisedAt)} — {reference.staffNames.get(r.revisedBy) ?? r.revisedBy}: {r.note}
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
