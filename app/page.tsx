'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/*
 * =============================================================
 * ACCUEIL DU HUB — la page qui répond à "qu'est-ce qu'il se
 * passe aujourd'hui" : la date, la météo, la production
 * solaire, puis les tâches du jour. Les deux applications
 * (News et Anime Stream) s'atteignent par le menu latéral.
 * =============================================================
 */

const COORDS_KEY = 'hub_coords';
const TODOS_KEY = 'hub_todos';

type Weather = {
  temperature: number;
  feltAs: number;
  label: string;
  icon: string;
  max: number;
  min: number;
};

type Todo = {
  id: string;
  text: string;
  done: boolean;
};

type GeoState =
  | 'idle'
  | 'asking'
  | 'ready'
  | 'refused'
  | 'failed';

function formatToday() {
  const formatted = new Date().toLocaleDateString(
    'fr-FR',
    {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }
  );

  return (
    formatted.charAt(0).toUpperCase() + formatted.slice(1)
  );
}

export default function HubHome() {
  const [today, setToday] = useState('');

  const [weather, setWeather] = useState<Weather | null>(
    null
  );

  const [geoState, setGeoState] = useState<GeoState>(
    'idle'
  );

  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');
  const [todosReady, setTodosReady] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  /*
   * =======================================================
   * DATE — calculée après le montage et jamais pendant le
   * rendu serveur. Le serveur et le téléphone ne sont pas
   * forcément dans le même fuseau : afficher la date rendue
   * côté serveur provoquerait un décalage visible d'un jour
   * pour un utilisateur couché tard, et une erreur
   * d'hydratation React.
   * =======================================================
   */

  useEffect(() => {
    setToday(formatToday());
  }, []);

  /*
   * =======================================================
   * MÉTÉO — la position est demandée une seule fois puis
   * conservée. Redemander à chaque ouverture ferait
   * réapparaître la fenêtre d'autorisation du navigateur et
   * consommerait le GPS pour rien.
   * =======================================================
   */

  useEffect(() => {
    let cancelled = false;

    const fetchFor = async (
      lat: number,
      lon: number
    ) => {
      try {
        const res = await fetch(
          `/api/weather?lat=${lat}&lon=${lon}`
        );

        if (!res.ok) throw new Error('meteo');

        const data = await res.json();

        if (!cancelled) {
          setWeather(data);
          setGeoState('ready');
        }
      } catch {
        if (!cancelled) setGeoState('failed');
      }
    };

    let stored: { lat: number; lon: number } | null =
      null;

    try {
      const raw = localStorage.getItem(COORDS_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }

    if (
      stored &&
      Number.isFinite(stored.lat) &&
      Number.isFinite(stored.lon)
    ) {
      fetchFor(stored.lat, stored.lon);
      return () => {
        cancelled = true;
      };
    }

    if (!navigator.geolocation) {
      setGeoState('failed');
      return () => {
        cancelled = true;
      };
    }

    setGeoState('asking');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        try {
          localStorage.setItem(
            COORDS_KEY,
            JSON.stringify({ lat, lon })
          );
        } catch {
          // localStorage indisponible
        }

        fetchFor(lat, lon);
      },
      () => {
        if (!cancelled) setGeoState('refused');
      },
      { timeout: 8000, maximumAge: 600000 }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * =======================================================
   * TÂCHES — lues au montage, puis réécrites à chaque
   * changement. `todosReady` évite d'écraser la liste
   * enregistrée par le tableau vide du tout premier rendu.
   * =======================================================
   */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TODOS_KEY);

      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setTodos(parsed);
      }
    } catch {
      // localStorage indisponible
    }

    setTodosReady(true);
  }, []);

  useEffect(() => {
    if (!todosReady) return;

    try {
      localStorage.setItem(
        TODOS_KEY,
        JSON.stringify(todos)
      );
    } catch {
      // localStorage indisponible
    }
  }, [todos, todosReady]);

  const addTodo = () => {
    const text = draft.trim();

    if (!text) return;

    setTodos((prev) => [
      ...prev,
      {
        id:
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 6),
        text,
        done: false,
      },
    ]);

    setDraft('');
    inputRef.current?.focus();
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id
          ? { ...todo, done: !todo.done }
          : todo
      )
    );
  };

  const removeTodo = (id: string) => {
    setTodos((prev) =>
      prev.filter((todo) => todo.id !== id)
    );
  };

  const remaining = todos.filter((t) => !t.done).length;

  return (
    <main className="page hub-page">

      <header className="hub-header">

        <span className="eyebrow">AUJOURD&apos;HUI</span>

        <h1>{today || ' '}</h1>

      </header>

      {/* ---------------------------------------------
          MÉTÉO
          --------------------------------------------- */}

      <section className="hub-tile hub-weather">

        {weather ? (
          <>

            <span className="hub-weather-icon">
              {weather.icon}
            </span>

            <div className="hub-weather-main">

              <strong>{weather.temperature}°</strong>

              <span>{weather.label}</span>

            </div>

            <div className="hub-weather-side">

              <span>
                Ressenti {weather.feltAs}°
              </span>

              <span>
                {weather.min}° / {weather.max}°
              </span>

            </div>

          </>
        ) : (
          <div className="hub-tile-empty">

            {geoState === 'asking' && (
              <p>Localisation en cours…</p>
            )}

            {geoState === 'refused' && (
              <p>
                Localisation refusée. Autorise-la dans
                les réglages du navigateur pour voir la
                météo.
              </p>
            )}

            {geoState === 'failed' && (
              <p>Météo indisponible pour le moment.</p>
            )}

            {geoState === 'idle' && <p>Météo…</p>}

          </div>
        )}

      </section>

      {/* ---------------------------------------------
          SOLAIRE — en attente d'une source de données.
          Voir le commentaire plus bas.
          --------------------------------------------- */}

      <section className="hub-tile hub-solar">

        <div className="hub-tile-head">

          <span className="hub-tile-label">
            SOLAIRE
          </span>

        </div>

        <div className="hub-tile-empty">

          <p>
            Pas encore relié à l&apos;onduleur. Ses
            données ne sortent pas du réseau local :
            il faut un appareil allumé en permanence à
            la maison pour les relayer.
          </p>

        </div>

      </section>

      {/* ---------------------------------------------
          TÂCHES
          --------------------------------------------- */}

      <section className="hub-section">

        <div className="hub-tile-head">

          <span className="hub-tile-label">
            À FAIRE
          </span>

          {remaining > 0 && (
            <span className="count-badge">
              {remaining}
            </span>
          )}

        </div>

        <div className="todo-input-row">

          <input
            ref={inputRef}
            className="todo-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTodo();
            }}
            placeholder="Ajouter une tâche"
          />

          <button
            type="button"
            className="todo-add"
            onClick={addTodo}
            disabled={draft.trim().length === 0}
            aria-label="Ajouter"
          >
            +
          </button>

        </div>

        {todos.length === 0 ? (
          <p className="todo-empty">
            Rien de prévu pour l&apos;instant.
          </p>
        ) : (
          <ul className="todo-list">

            {todos.map((todo) => (
              <li
                key={todo.id}
                className={
                  todo.done
                    ? 'todo-row is-done'
                    : 'todo-row'
                }
              >

                <button
                  type="button"
                  className="todo-check"
                  onClick={() => toggleTodo(todo.id)}
                  aria-label={
                    todo.done
                      ? 'Marquer comme à faire'
                      : 'Marquer comme fait'
                  }
                >
                  {todo.done ? '✓' : ''}
                </button>

                <span className="todo-text">
                  {todo.text}
                </span>

                <button
                  type="button"
                  className="todo-remove"
                  onClick={() => removeTodo(todo.id)}
                  aria-label="Supprimer"
                >
                  ✕
                </button>

              </li>
            ))}

          </ul>
        )}

      </section>

      {/* ---------------------------------------------
          RACCOURCIS VERS LES DEUX APPLICATIONS
          --------------------------------------------- */}

      <section className="hub-section">

        <div className="hub-shortcuts">

          <Link href="/tech" className="hub-shortcut">

            <span className="hub-shortcut-icon">◈</span>

            <span className="hub-shortcut-text">

              <strong>News</strong>

              <small>Actualité tech</small>

            </span>

          </Link>

          <Link href="/anime" className="hub-shortcut">

            <span className="hub-shortcut-icon">▶</span>

            <span className="hub-shortcut-text">

              <strong>Anime Stream</strong>

              <small>Séries et planning</small>

            </span>

          </Link>

        </div>

      </section>

    </main>
  );
}
