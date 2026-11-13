import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { PlaceCatalog, PlaceSuggestion } from './types';

type Props = {
  id: string;
  label: string;
  value: string;
  otherValue: string;
  placeholder: string;
  catalog: PlaceCatalog | null;
  catalogError: boolean;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
};

function normalizePlaceName(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pl')
    .replace(/ł/g, 'l').replace(/[\s,]+/g, ' ').trim();
}

export function PlaceField({ id, label, value, otherValue, placeholder, catalog, catalogError, disabled, error, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = normalizePlaceName(value);
  const excluded = normalizePlaceName(otherValue);
  const suggestions = catalog?.places.filter((place) => {
    const placeValue = normalizePlaceName(place.value);
    const placeLabel = normalizePlaceName(place.label);
    return excluded !== placeValue && excluded !== placeLabel
      && query.split(' ').every((term) => placeLabel.includes(term) || placeValue.includes(term));
  }) ?? [];
  const popup = open && !disabled && suggestions.length > 0;
  const active = popup ? suggestions[activeIndex] : undefined;
  const hint = open && !disabled && !popup
    ? catalogError ? 'Podpowiedzi są chwilowo niedostępne.'
      : !catalog ? 'Wczytywanie podpowiedzi…'
      : catalog.places.length === 0 ? 'Brak dostępnych podpowiedzi.'
      : 'Brak pasujących podpowiedzi.'
    : '';
  const describedBy = [error && id + '-error', hint && id + '-hint'].filter(Boolean).join(' ');

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function choose(place: PlaceSuggestion) {
    onChange(place.value);
    close();
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!suggestions.length) return;
        event.preventDefault();
        setOpen(true);
        const lastIndex = suggestions.length - 1;
        const next = event.key === 'ArrowDown'
          ? Math.min(activeIndex + 1, lastIndex)
          : activeIndex < 0 ? lastIndex : Math.max(activeIndex - 1, 0);
        setActiveIndex(next);
        break;
      }
      case 'Enter':
        if (active) {
          event.preventDefault();
          choose(active);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close();
        }
        break;
    }
  }

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="place-input">
      <input
        id={id}
        name={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={popup}
        aria-controls={popup ? id + '-places' : undefined}
        aria-activedescendant={active ? id + '-place-' + activeIndex : undefined}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        value={value}
        placeholder={placeholder}
        required
        maxLength={120}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={handleKey}
      />
      {popup && <ul id={id + '-places'} className="place-suggestions" role="listbox" aria-label={label}>
        {suggestions.map((place, index) => <li
          id={id + '-place-' + index}
          key={place.value}
          role="option"
          aria-selected={index === activeIndex}
          aria-label={catalog?.testData ? place.label + ', przykład testowy' : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(place)}
        >{place.label}{catalog?.testData && <small>Przykład testowy</small>}</li>)}
      </ul>}
    </div>
    {error && <p className="field-error" id={id + '-error'}>{error}</p>}
    {hint && <p className="place-hint" id={id + '-hint'} aria-live="polite">{hint}</p>}
  </div>;
}
