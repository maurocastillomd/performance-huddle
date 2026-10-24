import { useCallback, useEffect, useState } from 'react';
import type { Brief, BriefItem, SessionInfo } from '../../shared/types.js';
import { BRIEF_SECTION_HELP, BRIEF_SECTION_LABELS, BRIEF_SECTION_ORDER } from '../../shared/types.js';
import type { Reference } from '../App.js';
import { api } from '../api.js';
import { Chip, EmptyState, ErrorBox, Field, Loading, formatDateTime } from '../components/Bits.js';
import { SourceDrawer } from '../components/SourceDrawer.js';

const REVIEW_LABEL: Record<BriefItem['reviewState'], { label: string; tone: 'neutral' | 'ok' | 'warn'; glyph: string }> = {
  needs_review: { label: 'Needs review', tone: 'warn', glyph: '?' },
  confirmed: { label: 'Confirmed', tone: 'ok', glyph: '✓' },
  edited: { label: 'Edited', tone: 'ok', glyph: '✎' },
  dismissed: { label: 'Dismissed', tone: 'neutral', glyph: '×' },
};

const FLAG_LABEL: Record<string, { label: string; tone: 'danger' | 'warn'; glyph: string }> = {
  untrusted_content: { label: 'Note contains instruction-like text', tone: 'danger', glyph: '!' },
  sensitive_source: { label: 'Restricted source', tone: 'danger', glyph: '!' },
  ai_unverified: { label: 'Model interpretation', tone: 'warn', glyph: 'AI' },
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function HuddleScreen({
  session,
  reference,
  onGoToDecisions,
}: {
  session: SessionInfo;
  reference: Reference;
  onGoToDecisions: () => void;
}) {
  const [audienceId, setAudienceId] = useState(session.user.audiences[0]?.id ?? '');
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerSources, setDrawerSources] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<{ itemId: string; text: string } | null>(null);
  const [decisionFrom, setDecisionFrom] = useState<BriefItem | null>(null);

  const canApprove = session.user.permissions.includes('approve');

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.briefs(audienceId || undefined);
      setBriefs(list);
      setBrief(list[0] ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [audienceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.generateBrief(audienceId);
      setBrief(created);
      setBriefs((b) => [created, ...(b ?? [])]);
      setNotice(`Draft ${created.id} built from ${created.sourceUpdateIds.length} approved sources.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const review = async (itemId: string, action: 'confirm' | 'edit' | 'dismiss', note?: string): Promise<void> => {
    if (!brief) return;
    setError(null);
    try {
      setBrief(await api.reviewItem(brief.id, itemId, action, note ?? null));
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const approve = async (): Promise<void> => {
    if (!brief) return;
    setBusy(true);
    setError(null);
    try {
      const approved = await api.approveBrief(brief.id);
      setBrief(approved);
      setNotice(`Brief ${approved.id} approved. It can be exported to its audience now.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pending = brief?.items.filter((i) => i.reviewState === 'needs_review').length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Daily Huddle</h1>
          <p>
            One brief per audience per day. The five sections below are built from approved updates in that audience
            only. Facts are computed in code; the model contributes questions, marked as such.
          </p>
        </div>
        <div className="actions">
          <label className="sr-only" htmlFor="aud">
            Audience
          </label>
          <select id="aud" value={audienceId} onChange={(e) => setAudienceId(e.target.value)} style={{ width: 'auto' }}>
            {session.user.audiences.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.sensitive ? ' (restricted)' : ''}
              </option>
            ))}
          </select>
          <button
            className="primary"
            onClick={() => void generate()}
            disabled={busy || !canApprove}
            title={canApprove ? undefined : 'Generating a brief needs approval permission.'}
          >
            {busy ? 'Working...' : "Build today's brief"}
          </button>
        </div>
      </div>

      {!canApprove ? (
        <div className="alert info">
          You can read approved briefs for your audiences. Building, editing, and approving a brief is a separate
          permission your record does not carry.
        </div>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      {notice ? <div className="alert info">{notice}</div> : null}

      {briefs && briefs.length > 1 ? (
        <div className="card" style={{ marginBottom: '0.75rem' }}>
          <div className="meta" style={{ marginBottom: '0.4rem' }}>
            Earlier briefs for this audience
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {briefs.map((b) => (
              <button
                key={b.id}
                className={`chip${b.id === brief?.id ? ' accent' : ''}`}
                onClick={() => setBrief(b)}
              >
                {b.id} · {b.date} · {b.status}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {briefs === null ? <Loading label="Loading briefs" /> : null}

      {briefs?.length === 0 ? (
        <EmptyState
          title="No brief yet for this audience"
          hint={canApprove ? 'Build today’s brief to see what the updates add up to.' : 'A reviewer builds the brief.'}
        />
      ) : null}

      {brief ? (
        <>
          <div className="card">
            <div className="card-head">
              <h2>
                {brief.date} — {reference.audiences.get(brief.audienceId)?.name ?? brief.audienceId}
              </h2>
              <Chip
                tone={brief.status === 'approved' ? 'ok' : brief.status === 'invalidated' ? 'danger' : 'warn'}
                glyph={brief.status === 'approved' ? '✓' : brief.status === 'invalidated' ? '!' : '•'}
              >
                {brief.status === 'draft' ? 'Draft' : brief.status === 'approved' ? 'Approved' : 'Invalidated'}
              </Chip>
              <Chip mono>{brief.id}</Chip>
              <div className="spacer" />
              {brief.status === 'approved' ? (
                <a className="chip accent" href={api.exportUrl(brief.id)}>
                  Export for this audience
                </a>
              ) : null}
              {brief.status === 'draft' && canApprove ? (
                <button className="primary small" onClick={() => void approve()} disabled={busy || pending > 0}>
                  {pending > 0 ? `${pending} item${pending === 1 ? '' : 's'} left to review` : 'Approve brief'}
                </button>
              ) : null}
            </div>

            <div className="meta" style={{ marginTop: '0.5rem' }}>
              <span>{brief.sourceUpdateIds.length} approved sources in this audience</span>
              <span className="dot">Built {formatDateTime(brief.createdAt)}</span>
              {brief.approvedBy ? (
                <span className="dot">Approved by {reference.staffNames.get(brief.approvedBy) ?? brief.approvedBy}</span>
              ) : null}
            </div>

            {brief.status === 'invalidated' ? (
              <div className="alert error" style={{ marginTop: '0.7rem', marginBottom: 0 }}>
                {brief.invalidatedReason ?? 'One of the sources changed after this brief was built.'} Build a new one.
              </div>
            ) : null}

            <div className={`alert ${brief.ai.available ? 'warn' : 'error'}`} style={{ marginTop: '0.7rem', marginBottom: 0 }}>
              <strong>{brief.ai.available ? 'Model output on this brief:' : 'Model unavailable:'}</strong>{' '}
              {brief.ai.available ? (
                <>
                  {brief.ai.label}. It proposed {brief.ai.itemsProposed} possible disagreement
                  {brief.ai.itemsProposed === 1 ? '' : 's'}
                  {brief.ai.itemsRejected > 0 ? `, ${brief.ai.itemsRejected} rejected before display` : ''}. It cannot
                  approve anything, change a plan, or say anything medical.
                </>
              ) : (
                brief.ai.unavailableReason
              )}
              {brief.ai.rejectionReasons.length > 0 ? (
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                  {brief.ai.rejectionReasons.map((r, i) => (
                    <li key={i} style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {BRIEF_SECTION_ORDER.map((section) => {
            const items = brief.items.filter((i) => i.section === section);
            return (
              <section className="section" key={section}>
                <div className="section-head">
                  <h3>{BRIEF_SECTION_LABELS[section]}</h3>
                  <span className="help">{BRIEF_SECTION_HELP[section]}</span>
                  <span className="count">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="empty" style={{ marginTop: '0.6rem' }}>
                    Nothing to flag.
                  </div>
                ) : null}
                {items.map((item) => {
                  const state = REVIEW_LABEL[item.reviewState];
                  return (
                    <div
                      className={`card item origin-${item.origin} state-${item.reviewState}`}
                      key={item.id}
                      style={{ marginTop: '0.6rem' }}
                    >
                      <div className="card-head">
                        <strong>{item.title}</strong>
                        <div className="spacer" />
                        <Chip tone={item.origin === 'ai' ? 'warn' : 'neutral'} glyph={item.origin === 'ai' ? 'AI' : 'fx'}>
                          {item.origin === 'ai' ? 'Model interpretation' : 'Computed in code'}
                        </Chip>
                        <Chip tone={state.tone} glyph={state.glyph}>
                          {state.label}
                        </Chip>
                      </div>

                      <p className="body-text">{item.detail}</p>

                      {item.clarifyingQuestion ? (
                        <div className="question">
                          <strong>Question to ask:</strong> {item.clarifyingQuestion}
                        </div>
                      ) : null}

                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {item.flags
                          .filter((f) => !(f === 'ai_unverified' && item.origin === 'ai'))
                          .map((f) => {
                            const meta = FLAG_LABEL[f];
                            return meta ? (
                              <Chip key={f} tone={meta.tone} glyph={meta.glyph}>
                                {meta.label}
                              </Chip>
                            ) : null;
                          })}
                        <button className="chip" onClick={() => setDrawerSources(item.sourceUpdateIds)}>
                          Sources: {item.sourceUpdateIds.join(', ') || 'none'}
                        </button>
                      </div>

                      {item.reviewedBy ? (
                        <div className="meta" style={{ marginTop: '0.45rem' }}>
                          {state.label} by {reference.staffNames.get(item.reviewedBy) ?? item.reviewedBy}
                          {item.reviewedAt ? ` · ${formatDateTime(item.reviewedAt)}` : ''}
                          {item.reviewNote ? ` · ${item.reviewNote}` : ''}
                        </div>
                      ) : null}

                      {editing?.itemId === item.id ? (
                        <div style={{ marginTop: '0.6rem' }}>
                          <Field label="Replacement text">
                            <textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                          </Field>
                          <div className="item-actions">
                            <button className="primary small" onClick={() => void review(item.id, 'edit', editing.text)}>
                              Save edit
                            </button>
                            <button className="small" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {brief.status === 'draft' && canApprove && editing?.itemId !== item.id ? (
                        <div className="item-actions">
                          <button className="small" onClick={() => void review(item.id, 'confirm')}>
                            Confirm
                          </button>
                          <button className="small" onClick={() => setEditing({ itemId: item.id, text: item.detail })}>
                            Edit
                          </button>
                          <button className="small" onClick={() => void review(item.id, 'dismiss')}>
                            Dismiss
                          </button>
                          <button className="small" onClick={() => setDecisionFrom(item)}>
                            Record decision
                          </button>
                        </div>
                      ) : null}

                      {brief.status !== 'draft' && canApprove ? (
                        <div className="item-actions">
                          <button className="small" onClick={() => setDecisionFrom(item)}>
                            Record decision
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </>
      ) : null}

      {drawerSources ? (
        <SourceDrawer
          sourceIds={drawerSources}
          summaries={brief?.aiSummaries ?? []}
          athletes={reference.athletes}
          audiences={reference.audiences}
          staffNames={reference.staffNames}
          onClose={() => setDrawerSources(null)}
        />
      ) : null}

      {decisionFrom && brief ? (
        <DecisionDialog
          item={decisionFrom}
          brief={brief}
          reference={reference}
          onClose={() => setDecisionFrom(null)}
          onSaved={(msg) => {
            setDecisionFrom(null);
            setNotice(msg);
            onGoToDecisions();
          }}
        />
      ) : null}
    </>
  );
}

function DecisionDialog({
  item,
  brief,
  reference,
  onClose,
  onSaved,
}: {
  item: BriefItem;
  brief: Brief;
  reference: Reference;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  // An unowned-action item already reads as an action. Everything else is a
  // description of a problem, so the reviewer writes what was agreed.
  const [action, setAction] = useState(
    item.section === 'actionsMissingOwner' ? item.title.replace(/^No owner:\s*/, '') : '',
  );
  const [ownerId, setOwnerId] = useState('');
  const [rationale, setRationale] = useState(item.detail.slice(0, 400));
  const [dueDate, setDueDate] = useState(addDays(todayIso(), 1));
  const [reviewDate, setReviewDate] = useState(addDays(todayIso(), 7));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const created = await api.createDecision({
        audienceId: brief.audienceId,
        athleteId: item.athleteId,
        action,
        ownerId: ownerId || null,
        rationale,
        dueDate,
        reviewDate,
        sourceUpdateIds: item.sourceUpdateIds,
        briefId: brief.id,
      });
      onSaved(`Decision ${created.id} recorded${created.ownerId ? '' : ' with no owner yet'}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Record a decision"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>Record a decision</h2>
          <button className="subtle" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="alert info" style={{ marginBottom: '0.8rem' }}>
          <strong>Raised by:</strong> {item.title}
        </div>
        <p className="meta" style={{ marginBottom: '0.8rem' }}>
          A person records this. The model has no route to this form. Sources carry over from{' '}
          {item.sourceUpdateIds.join(', ') || 'no source'}.
        </p>
        {error ? <ErrorBox message={error} /> : null}
        <div className="form-grid">
          <Field label="Agreed action" full hint="What the group decided to do. Start with a verb.">
            <input
              value={action}
              placeholder="Move the lift to 11:00 so hitting keeps the 14:30 slot"
              onChange={(e) => setAction(e.target.value)}
            />
          </Field>
          <Field label="Owner" hint="Leave empty and the next brief will flag it.">
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Nobody yet</option>
              {reference.staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Review date">
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </Field>
          <Field label="Rationale" full>
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem' }}>
          <button className="primary" onClick={() => void save()} disabled={saving || !action.trim() || !rationale.trim()}>
            {saving ? 'Saving...' : 'Record decision'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </aside>
    </div>
  );
}
