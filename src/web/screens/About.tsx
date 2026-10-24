import type { SessionInfo } from '../../shared/types.js';
import type { AppBootstrap } from '../api.js';
import { Chip } from '../components/Bits.js';

export function AboutScreen({ session, bootstrap }: { session: SessionInfo; bootstrap: AppBootstrap | null }) {
  return (
    <div className="prose" style={{ maxWidth: '78ch' }}>
      <div className="page-head">
        <div>
          <h1>About this demo</h1>
          <p>
            Performance Huddle is a portfolio project. It is not in use with any club, and it holds no real data
            about any person.
          </p>
        </div>
      </div>

      <div className="alert warn">
        <strong>Every athlete, staff member, note, and date here is invented.</strong> The roster is a fictional
        Double-A club. Nothing in this application came from a real organization, and no real athlete information
        has ever been loaded into it.
      </div>

      <div className="card">
        <h3>What the medical audience contains</h3>
        <p>
          Updates in the restricted audience carry <strong>approved participation guidance</strong>: what an athlete
          is cleared to do. They are not diagnoses, treatment notes, or clinical records, and the application is not
          built to hold those. The guidance is still treated as sensitive: a separate audience, separate membership,
          and a marker on every item built from it.
        </p>
      </div>

      <div className="card">
        <h3>What the model does, and what it never does</h3>
        <p>Right now this deployment is running: <Chip tone={session.aiProviderKind === 'mock' ? 'warn' : 'accent'} glyph="AI">{session.aiProviderLabel}</Chip></p>
        <ul>
          <li>It summarizes approved notes, proposes possible disagreements, and drafts a question to ask.</li>
          <li>Every one of its items is labelled, starts as “needs review”, and links to the sources it used.</li>
          <li>
            It cannot approve a brief, record a decision, change a plan, or say anything medical. Those paths do not
            read model output at all.
          </li>
          <li>
            Notes are passed to it as data between explicit markers. Text inside a note that tries to give the model
            orders is marked in the interface and cannot change what the workflow does.
          </li>
          <li>Any source id it invents is rejected before display, and the count is shown on the brief.</li>
          <li>
            Athlete names are replaced with labels before anything leaves the server, and only sources approved for
            the brief’s audience are ever included.
          </li>
        </ul>
        <p>
          Time overlaps, expired review dates, missing owners, supersession and every workflow state are computed in
          ordinary code. When the model is unavailable, those sections still work and the brief says the model was
          not substituted.
        </p>
      </div>

      <div className="card">
        <h3>How access is decided</h3>
        <ul>
          <li>Every read and write checks organization, audience membership, and permission on the server.</li>
          <li>Submitting and approving are separate permissions.</li>
          <li>
            Memberships are read from the staff directory on every request. A revoked membership is denied on the
            next call, with no session cache in between.
          </li>
          <li>
            Being able to read a source does not authorize sharing it more widely. A brief may only cite sources
            approved for its own audience, and exports carry the same boundary.
          </li>
          <li>
            Withdrawing a source, or moving it to a different audience, invalidates every brief that cited it.
          </li>
          <li>Routine logs carry identifiers and counts. They never carry note text or athlete names.</li>
        </ul>
      </div>

      <div className="card">
        <h3>What is working and what is scaffolding</h3>
        <ul>
          <li>
            <strong>Working:</strong> the three screens, the authorization layer, the deterministic detections, the
            mock model provider, briefs, decisions, exports, search, and the tests over all of it.
          </li>
          <li>
            <strong>Written but never run against Microsoft:</strong> the Teams tab manifest, the Teams JavaScript
            bootstrap, and Entra ID token validation. They are covered by unit tests against locally generated keys,
            not by a live tenant.
          </li>
          <li>
            <strong>Written but never run against Azure:</strong> the Azure OpenAI adapter. The default demo makes no
            external calls of any kind.
          </li>
        </ul>
        <p>
          Data in this demo lives in server memory and is rebuilt on every restart. Appearing inside Microsoft Teams
          would not mean data stays inside Microsoft: it is processed wherever this server runs.
        </p>
      </div>

      <div className="card">
        <h3>Your access right now</h3>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Chip glyph="@">{session.user.name}</Chip>
          <Chip>{session.user.title}</Chip>
          <Chip tone={session.user.permissions.includes('approve') ? 'ok' : 'neutral'}>
            {session.user.permissions.length ? session.user.permissions.join(' + ') : 'read only'}
          </Chip>
          {session.user.audiences.map((a) => (
            <Chip key={a.id} tone={a.sensitive ? 'danger' : 'neutral'} glyph={a.sensitive ? '!' : undefined}>
              {a.name}
            </Chip>
          ))}
        </div>
        {bootstrap?.demoMode ? (
          <p className="meta" style={{ marginTop: '0.6rem' }}>
            Demo identity is on. The server refuses to start with it on when NODE_ENV=production.
          </p>
        ) : null}
      </div>
    </div>
  );
}
