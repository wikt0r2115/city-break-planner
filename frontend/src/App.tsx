import { useEffect, useState } from 'react';
import { fetchHealth, HealthError } from './api';

type Connection =
  | { status: 'loading' }
  | { status: 'ready'; checkedAt: Date }
  | { status: 'error'; message: string };

export const HEALTH_TIMEOUT_MS = 8000;

export default function App() {
  const [connection, setConnection] = useState<Connection>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, HEALTH_TIMEOUT_MS);

    fetchHealth(controller.signal)
      .then(() => {
        if (active) setConnection({ status: 'ready', checkedAt: new Date() });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = timedOut
          ? 'Sprawdzanie trwało zbyt długo. Spróbuj ponownie.'
          : error instanceof HealthError && error.kind === 'invalid-response'
            ? 'Aplikacja zwróciła nieprawidłową odpowiedź. Spróbuj ponownie.'
            : 'Aplikacja jest chwilowo niedostępna. Sprawdź, czy backend jest uruchomiony, i spróbuj ponownie.';
        setConnection({ status: 'error', message });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  function checkAgain() {
    setConnection({ status: 'loading' });
    setAttempt((previous) => previous + 1);
  }

  return (
    <div className="page">
      <header className="header">
        <a className="brand" href="/" aria-label="City Break Planner — strona główna">
          <span className="brand-mark" aria-hidden="true">↗</span>
          <span>city break<span className="brand-subtitle">PLANNER</span></span>
        </a>
        <span className="edition">Dla studentów. Z ciekawości świata.</span>
      </header>

      <main id="main-content">
        <section className="intro" aria-labelledby="intro-title">
          <p className="eyebrow"><span aria-hidden="true" /> NOWE MIEJSCA, TWÓJ RYTM</p>
          <h1 id="intro-title">Mały wyjazd.<br />Dużo <em>możliwości.</em></h1>
          <p className="lead">Pomysł na weekend zaczyna się tutaj. Łączymy podróż i zwiedzanie w jeden plan dopasowany do Twoich priorytetów.</p>
          <div className="priorities" aria-label="Planowane priorytety podróży">
            <span>Niższy koszt</span><span>Krótszy dojazd</span><span>Mniej przesiadek</span><span>Więcej czasu na miejscu</span>
          </div>
        </section>

        <section className="connection-card" aria-labelledby="connection-title">
          <div className="card-top"><span className="eyebrow">PIERWSZY KROK</span><span className="step">01 / START</span></div>
          <div className={`connection-symbol ${connection.status}`} aria-hidden="true">{connection.status === 'ready' ? '✓' : connection.status === 'error' ? '!' : '↗'}</div>
          <h2 id="connection-title">Zaczynamy od połączenia.</h2>
          <p className="card-description">Sprawdzamy, czy aplikacja jest gotowa na kolejny etap podróży.</p>
          <div className={`status-box ${connection.status}`} role="status" aria-live="polite" aria-atomic="true" aria-busy={connection.status === 'loading'}>
            <span className="status-dot" aria-hidden="true" />
            <div>
              <strong>{connection.status === 'loading' ? 'Sprawdzamy połączenie…' : connection.status === 'ready' ? 'Połączenie potwierdzone' : 'Nie udało się połączyć'}</strong>
              <p>{connection.status === 'loading' ? 'Czekamy na odpowiedź aplikacji.' : connection.status === 'ready' ? 'API i baza danych SQLite odpowiadają poprawnie.' : connection.message}</p>
            </div>
          </div>
          <button className="retry-button" type="button" onClick={checkAgain} disabled={connection.status === 'loading'}>
            {connection.status === 'loading' ? 'Trwa sprawdzanie' : 'Sprawdź ponownie'}<span aria-hidden="true">↗</span>
          </button>
          <p className="checked-at">{connection.status === 'ready' ? `Ostatnie sprawdzenie: ${connection.checkedAt.toLocaleTimeString('pl-PL')}` : 'Status pochodzi z działającego API.'}</p>
        </section>

        <aside className="next-step" aria-labelledby="next-step-title">
          <span className="next-step-icon" aria-hidden="true">◎</span>
          <div><h2 id="next-step-title">Tu powstaje Twój planer.</h2><p>To wersja startowa. Wyszukiwanie połączeń, edycja i udostępnianie planów pojawią się w kolejnych etapach.</p></div>
          <span className="stage">SOL-114</span>
        </aside>
      </main>

      <footer><span>City Break Planner</span><span>Mniej organizowania. Więcej odkrywania.</span></footer>
    </div>
  );
}
