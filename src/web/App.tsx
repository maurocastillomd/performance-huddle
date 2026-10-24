import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Athlete, Audience, SessionInfo } from '../shared/types.js';
import { api, ApiError, type AppBootstrap, type StaffRef } from './api.js';
import { Chip, ErrorBox, Loading } from './components/Bits.js';
import { AboutScreen } from './screens/About.js';
import { DecisionsScreen } from './screens/Decisions.js';
import { HuddleScreen } from './screens/Huddle.js';
import { SignInScreen } from './screens/SignIn.js';
import { UpdatesScreen } from './screens/Updates.js';
import { initTeams } from './teams.js';

export type Tab = 'updates' | 'huddle' | 'decisions' | 'about';

export interface Reference {
  athletes: Map<string, Athlete>;
  athleteList: Athlete[];
  staffNames: Map<string, string>;
  staffList: StaffRef[];
  audiences: Map<string, Audience>;
  audienceList: Audience[];
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'updates', label: 'Updates' },
  { id: 'huddle', label: 'Daily Huddle' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'about', label: 'About this demo' },
];

export function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const [tab, setTab] = useState<Tab>('huddle');
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const loadSession = useCallback(async () => {
    try {
      const s = await api.session();
      setSession(s);
      const [athleteList, staffList, audienceList] = await Promise.all([
        api.athletes(),
        api.staff(),
        api.audiences(),
      ]);
      setReference({
        athletes: new Map(athleteList.map((a) => [a.id, a])),
        athleteList,
        staffNames: new Map(staffList.map((s2) => [s2.id, s2.name])),
        staffList,
        audiences: new Map(audienceList.map((a) => [a.id, a])),
        audienceList,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        setReference(null);
      } else {
        setError((err as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    // The Teams host is optional. Standalone is the supported demo path.
    void initTeams();
    api
      .bootstrap()
      .then(async (b) => {
        setBootstrap(b);
        await loadSession();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBooting(false));
  }, [loadSession]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(null);
    setReference(null);
    setTab('huddle');
  }, []);

  const isDemo = bootstrap?.demoMode ?? false;

  const body = useMemo(() => {
    if (!session || !reference) return null;
    switch (tab) {
      case 'updates':
        return <UpdatesScreen session={session} reference={reference} />;
      case 'decisions':
        return <DecisionsScreen session={session} reference={reference} />;
      case 'about':
        return <AboutScreen session={session} bootstrap={bootstrap} />;
      case 'huddle':
      default:
        return <HuddleScreen session={session} reference={reference} onGoToDecisions={() => setTab('decisions')} />;
    }
  }, [tab, session, reference, bootstrap]);

  if (booting) {
    return (
      <main style={{ maxWidth: 620, marginTop: '3rem' }}>
        <Loading label="Starting Performance Huddle" />
      </main>
    );
  }

  if (error && !session) {
    return (
      <main style={{ maxWidth: 620, marginTop: '3rem' }}>
        <ErrorBox message={error} />
      </main>
    );
  }

  if (!session) {
    return <SignInScreen bootstrap={bootstrap} onSignedIn={loadSession} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Performance Huddle</strong>
          <span>{session.user.orgName}</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <Chip tone={session.aiProviderKind === 'mock' ? 'warn' : 'accent'} glyph="AI">
            {session.aiProviderKind === 'mock' ? 'Mock model' : 'Azure model'}
          </Chip>
          <Chip glyph="@" title={session.user.title}>
            {session.user.name}
          </Chip>
          <Chip tone={session.user.permissions.includes('approve') ? 'ok' : 'neutral'}>
            {session.user.permissions.length ? session.user.permissions.join(' + ') : 'read only'}
          </Chip>
          {isDemo ? (
            <button className="small" onClick={signOut}>
              Switch user
            </button>
          ) : null}
        </div>
      </header>

      {isDemo ? (
        <div className="banner">
          <strong>Demonstration.</strong> Synthetic athletes and synthetic notes. Identity switching is a demo
          feature that reads a staff record on the server; the browser never asserts a role. The server refuses to
          start with it enabled in production.
        </div>
      ) : null}

      <main>
        {error ? <ErrorBox message={error} /> : null}
        {body}
      </main>
    </div>
  );
}
