import { useEffect, useState } from 'react';
import { Prices } from './components';
import { duration } from './format';
import type { Attraction, Interest, PlanItem, Recommendations } from './types';

type Props = {
  attractions: Attraction[];
  selected: PlanItem[];
  disabled: boolean;
  contextKey: string;
  onRecommend: (interest: Interest, budget: number) => Promise<Recommendations | null>;
  onAdd: (attraction: Attraction) => void;
};

export function AttractionPicker({ attractions, selected, disabled, contextKey, onRecommend, onAdd }: Props) {
  const [interest, setInterest] = useState<Interest>('MIXED');
  const [budget, setBudget] = useState('150');
  const [error, setError] = useState('');
  const [response, setResponse] = useState<{ contextKey: string; data: Recommendations } | null>(null);
  const recommendations = response?.contextKey === contextKey ? response.data : null;
  const selectedIds = new Set(selected.map((item) => item.attractionId));
  useEffect(() => {
    setResponse(null);
    setError('');
  }, [contextKey]);

  async function requestRecommendations() {
    const limit = Number(budget);
    setResponse(null);
    if (!budget.trim() || !Number.isInteger(limit) || limit < 0 || limit > 10000) {
      setError('Wpisz pełną kwotę od 0 do 10 000 zł.');
      return;
    }
    setError('');
    const data = await onRecommend(interest, limit);
    if (data) setResponse({ contextKey, data });
  }

  return <aside className="attraction-list" aria-labelledby="attractions-title">
    <h3 id="attractions-title">Jeszcze coś do odkrycia</h3>
    {attractions.length === 0 ? <p className="empty-note">Nie ma dostępnych propozycji atrakcji. Zapisane miejsca pozostają w planie.</p>
      : <section className="attraction-card recommendation-form">
        <h4>Dobierz atrakcje</h4>
        <label>Zainteresowania
          <select value={interest} disabled={disabled} onChange={(event) => {
            setInterest(event.target.value as Interest);
            setResponse(null);
          }}>
            <option value="MIXED">Różne</option>
            <option value="CULTURE">Sztuka i kultura</option>
            <option value="OUTDOORS">Na zewnątrz</option>
            <option value="HISTORY">Historia</option>
          </select>
        </label>
        <label>Budżet na wstępy (zł)
          <input type="number" min="0" max="10000" step="1" value={budget} disabled={disabled}
            aria-invalid={!!error} aria-describedby={error ? 'attraction-budget-error' : undefined} onChange={(event) => {
              setBudget(event.target.value);
              setError('');
              setResponse(null);
            }} />
        </label>
        {error && <p className="field-error" role="alert" id="attraction-budget-error">{error}</p>}
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => void requestRecommendations()}>
          Zaproponuj atrakcje
        </button>
        {recommendations && <div role="status">
          <p>{recommendations.suggestions.length === 0 ? 'Brak atrakcji w tym budżecie i czasie.'
            : recommendations.aiUsed ? 'Propozycje z pomocą AI' : 'Propozycje z katalogu'}</p>
          {recommendations.suggestions.length > 0 && <ul>{recommendations.suggestions.map((item) => {
            const attraction = attractions.find((visit) => visit.id === item.attractionId);
            if (!attraction) return null;
            const added = selectedIds.has(item.attractionId);
            return <li key={item.attractionId}>
              <strong>{attraction.name}</strong> {item.reason}
              <button type="button" className="text-button" disabled={disabled || added} onClick={() => onAdd(attraction)}>
                {added ? 'Już w planie' : `Dodaj do planu: ${attraction.name}`}
              </button>
            </li>;
          })}</ul>}
        </div>}
      </section>}
    {attractions.map((attraction) => {
      const added = selectedIds.has(attraction.id);
      return <article className="attraction-card" key={attraction.id}>
        <h4>{attraction.name}</h4>
        <p className="muted">Na wizytę: {duration(attraction.visitMinutes)}</p>
        <Prices prices={attraction.entryPrices} />
        {attraction.openingHours.status === 'UNKNOWN' && <p className="warning-text">Godziny otwarcia niepotwierdzone</p>}
        <button type="button" className="secondary-button" disabled={disabled || added} onClick={() => onAdd(attraction)}>
          {added ? 'Już w planie' : `Dodaj: ${attraction.name}`}
        </button>
      </article>;
    })}
  </aside>;
}
