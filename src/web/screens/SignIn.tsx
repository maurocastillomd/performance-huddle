import { useState } from 'react';
import { api, type AppBootstrap } from '../api.js';
import { Chip, ErrorBox } from '../components/Bits.js';

export function SignInScreen({
  bootstrap,
  onSignedIn,
}: {
  bootstrap: AppBootstrap | null;
  onSignedIn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!bootstrap?.demoMode) {
    return (
      <div className="signin">
        <h1>Performance Huddle</h1>
        <div className="alert info" style={{ marginTop: '1rem' }}>
          Demo identity is disabled on this deployment. Sign-in comes from Microsoft Entra ID through the Teams
          tab. See <code>docs/TEAMS-INTEGRATION.md</code> for the tenant configuration this requires.
        </div>
      </div>
    );
  }

  const orgs = [...new Set(bootstrap.demoUsers.map((u) => u.orgId))];

  const choose = async (userId: string): Promise<void> => {
    setBusy(userId);
    setError(null);
    try {
      await api.signIn(userId);
      await onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="signin">
      <h1>Performance Huddle</h1>
      <p style={{ color: 'var(--ink-2)', maxWidth: '68ch', marginTop: '0.4rem' }}>
        A daily brief for a professional baseball performance department. Departments submit updates, code finds the
        clashes and the gaps, a model drafts the questions worth asking, and a person decides. Everything you see is
        synthetic.
      </p>

      <div className="alert warn" style={{ marginTop: '1rem' }}>
        <strong>Pick a staff member to see the application through their access.</strong> The button below sends a
        user id. The server looks that person up in its own directory and derives their organization, audiences, and
        permissions there. A role sent by the browser is never trusted.
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {orgs.map((orgId) => {
        const users = bootstrap.demoUsers.filter((u) => u.orgId === orgId);
        return (
          <section key={orgId} style={{ marginTop: '1.25rem' }}>
            <h2>{users[0]?.orgName ?? orgId}</h2>
            <div className="users">
              {users.map((u) => (
                <button
                  key={u.id}
                  className="card user-card"
                  onClick={() => void choose(u.id)}
                  disabled={busy !== null}
                >
                  <strong>{u.name}</strong>
                  <span className="meta">{u.title}</span>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                    <Chip tone={u.permissions.includes('approve') ? 'ok' : 'neutral'}>
                      {u.permissions.length ? u.permissions.join(' + ') : 'read only'}
                    </Chip>
                    {u.audiences.map((a) => (
                      <Chip key={a} tone={a.startsWith('Medical') ? 'danger' : 'neutral'}>
                        {a}
                      </Chip>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      <p className="meta" style={{ marginTop: '1.5rem' }}>
        Harbor City Herons is a second organization. Signing in as its staff shows that nothing from Riverbend is
        reachable across the boundary.
      </p>
    </div>
  );
}
