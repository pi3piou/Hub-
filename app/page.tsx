'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import SolarFlow from '@/components/SolarFlow';
import { getProfileCode } from '@/lib/profile';
import {
  PushState,
  cancelReminder,
  getPushState,
  enablePush,
  registerServiceWorker,
  scheduleReminder,
} from '@/lib/pushClient';
import {
  OFFSETS,
  ReminderOffset,
  Todo,
  computeFireAt,
  formatDue,
  isOverdue,
  offsetLabel,
  toLocalInputValue,
} from '@/lib/reminders';

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

type Solar = {
  production: number | null;
  consumption: number | null;
  grid: number | null;
  battery: number | null;
  autonomy: number | null;
  energyToday: number | null;
  receivedAt: number;
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

/*
 * Au-dessus du kilowatt on bascule d'unité : "3400 W" se lit
 * moins bien que "3,4 kW" sur une tuile qu'on survole du
 * regard.
 */

function formatWatts(value: number | null) {
  if (value === null) return '—';

  const watts = Math.round(value);

  if (Math.abs(watts) >= 1000) {
    return (
      (watts / 1000)
        .toFixed(1)
        .replace('.', ',') + ' kW'
    );
  }

  return watts + ' W';
}

function formatAge(seconds: number) {
  if (seconds < 90) return 'à l\'instant';

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return 'il y a ' + minutes + ' min';

  const hours = Math.round(minutes / 60);

  return 'il y a ' + hours + ' h';
}

export default function HubHome() {
  const [today, setToday] = useState('');

  const [weather, setWeather] = useState<Weather | null>(
    null
  );

  const [geoState, setGeoState] = useState<GeoState>(
    'idle'
  );

  const [solar, setSolar] = useState<Solar | null>(
    null
  );

  const [solarAge, setSolarAge] = useState<number | null>(
    null
  );

  const [solarReady, setSolarReady] = useState(false);

  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');
  const [todosReady, setTodosReady] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  /*
   * Réglages de l'échéance : repliés par défaut. La très
   * grande majorité des tâches n'a pas de date, et une
   * ligne de saisie qui affiche d'emblée un calendrier et
   * quatre boutons de rappel transforme « acheter du pain »
   * en formulaire.
   */

  const [dueDraft, setDueDraft] = useState('');

  const [offsetDraft, setOffsetDraft] =
    useState<ReminderOffset>('1h');

  const [showDue, setShowDue] = useState(false);

  const [pushState, setPushState] =
    useState<PushState>('unsupported');

  const [pushMessage, setPushMessage] = useState<
    string | null
  >(null);

  const [pushBusy, setPushBusy] = useState(false);

  /*
   * Les rappels voyagent par le profil : c'est lui qui
   * relie un appareil abonné à une tâche. Sans identifiant,
   * la planification n'a nulle part où aller — autant le
   * dire plutôt que de laisser une tâche datée ne jamais
   * sonner sans explication.
   */

  const [hasProfile, setHasProfile] = useState(true);

  /*
   * Miroir de la liste, lisible depuis une fonction
   * asynchrone démarrée plusieurs rendus plus tôt. Une
   * closure y verrait l'état du moment où elle a été créée ;
   * ici il faut celui d'après la réponse du serveur.
   */

  const todosRef = useRef<Todo[]>([]);

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
   * SOLAIRE — on interroge notre propre API, qui relit le
   * dernier relevé poussé par l'onduleur. Rafraîchi toutes
   * les 60 secondes tant que la page est visible : inutile
   * de solliciter le stockage quand le téléphone est dans
   * une poche.
   * =======================================================
   */

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (document.visibilityState !== 'visible') return;

      try {
        const res = await fetch('/api/solar');
        const data = await res.json();

        if (cancelled) return;

        setSolar(data.reading || null);
        setSolarAge(
          typeof data.ageSeconds === 'number'
            ? data.ageSeconds
            : null
        );
      } catch {
        if (!cancelled) setSolar(null);
      } finally {
        if (!cancelled) setSolarReady(true);
      }
    };

    load();

    const timer = setInterval(load, 60000);

    document.addEventListener('visibilitychange', load);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener(
        'visibilitychange',
        load
      );
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
    todosRef.current = todos;

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

  /*
   * =======================================================
   * NOTIFICATIONS — état lu au montage, et service worker
   * enregistré au passage. L'enregistrement est sans effet
   * tant qu'aucune autorisation n'est accordée ; le faire
   * tôt évite une attente au moment du premier clic.
   * =======================================================
   */

  useEffect(() => {
    const state = getPushState();
    const code = getProfileCode();

    setPushState(state);
    setHasProfile(Boolean(code));

    registerServiceWorker();

    /*
     * Ré-enregistrement silencieux quand l'autorisation est
     * déjà accordée.
     *
     * Un abonnement peut cesser d'être valide sans que rien
     * ne le signale : identifiant de profil changé (les
     * abonnements sont rangés par profil, le nouveau n'en a
     * aucun), abonnement purgé par le serveur après un 410,
     * ou renouvelé par le navigateur. Dans les trois cas
     * `Notification.permission` reste « granted », donc la
     * bannière ne réapparaît jamais et il n'existe aucun
     * moyen de rattraper le coup.
     *
     * Quand la permission est acquise,
     * `requestPermission()` répond sans rien afficher et
     * `getSubscription()` réutilise l'abonnement existant :
     * l'appel est inoffensif et idempotent.
     */

    if (state === 'granted' && code) {
      enablePush(code).catch(() => {
        // Simple remise à niveau, rien à signaler
      });
    }
  }, []);

  /*
   * L'autorisation peut être accordée depuis les réglages du
   * téléphone, hors de l'application. Sans cette relecture au
   * retour au premier plan, la bannière continuerait de
   * réclamer une activation déjà faite.
   */

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        setPushState(getPushState());
        setHasProfile(Boolean(getProfileCode()));
      }
    };

    document.addEventListener(
      'visibilitychange',
      refresh
    );

    return () => {
      document.removeEventListener(
        'visibilitychange',
        refresh
      );
    };
  }, []);

  const activatePush = async () => {
    const code = getProfileCode();

    if (!code) {
      setPushMessage(
        'Choisis d’abord un identifiant de profil, dans le menu, pour recevoir les rappels.'
      );
      return;
    }

    setPushBusy(true);
    setPushMessage(null);

    /*
     * Le `finally` n'est pas décoratif : `subscribe()`
     * rejette pour de bon quand la clé VAPID est mal formée
     * ou que Safari refuse, et sans lui le bouton resterait
     * bloqué sur « Activation… », désactivé, sans message —
     * plus aucun moyen de réessayer sans recharger la page,
     * et c'est justement le cas d'une mauvaise configuration.
     */

    try {
      const result = await enablePush(code);

      setPushState(result.state);

      if (!result.ok) {
        setPushMessage(
          result.error || 'Activation impossible.'
        );
        return;
      }

      /*
       * Rattrapage des tâches déjà créées.
       *
       * Sans lui, l'ordre naturel des choses ne fonctionne
       * pas : on note un rendez-vous, la bannière propose
       * alors d'activer les notifications, on accepte — et
       * ce rendez-vous-là, justement, ne sonne jamais,
       * parce qu'aucun appareil n'était abonné quand il a
       * été planifié.
       */

      const pending = todos.filter(
        (t) =>
          !t.done && t.dueAt && t.dueAt > Date.now()
      );

      let scheduled = 0;

      for (const todo of pending) {
        /*
         * On planifie AVANT d'annuler. La fiche du rappel
         * est réécrite par le nouvel envoi de toute façon,
         * si bien que l'annulation ne sert plus qu'à
         * retirer l'ancien message chez QStash. Dans
         * l'autre ordre, un échec de planification laissait
         * la tâche sans aucun rappel, là où elle en avait
         * peut-être un qui fonctionnait.
         */

        const scheduleId = await scheduleReminder(
          code,
          todo
        );

        if (!scheduleId) continue;

        if (todo.scheduleId) {
          await cancelReminder(
            code,
            todo.id,
            todo.scheduleId
          );
        }

        scheduled += 1;

        setTodos((prev) =>
          prev.map((t) =>
            t.id === todo.id ? { ...t, scheduleId } : t
          )
        );
      }

      /*
       * Le compte porte sur les rappels réellement posés,
       * pas sur les tentatives. L'abonnement peut très bien
       * réussir alors que la planification échoue — il
       * suffit que QStash ne soit pas configuré — et
       * annoncer « 2 tâches programmées » serait alors
       * faux, sur la seule chose qui compte ici.
       */

      setPushMessage(
        scheduled > 0
          ? `Rappels activés — ${scheduled} tâche${
              scheduled > 1 ? 's' : ''
            } programmée${scheduled > 1 ? 's' : ''}.`
          : pending.length > 0
          ? 'Rappels activés, mais la programmation a échoué. L’export calendrier reste disponible sur chaque tâche.'
          : 'Rappels activés sur cet appareil.'
      );
    } catch {
      setPushMessage(
        'Activation impossible. Réessaie dans un instant.'
      );
    } finally {
      setPushBusy(false);
    }
  };

  /*
   * =======================================================
   * PLANIFICATION
   *
   * Le serveur est prévenu après coup, jamais avant :
   * l'ajout d'une tâche doit se voir immédiatement, même
   * hors réseau. Si la planification échoue, la tâche et sa
   * date existent quand même — seule la notification
   * manque, et l'export calendrier reste là pour ça.
   * =======================================================
   */

  const planReminder = async (todo: Todo) => {
    const code = getProfileCode();

    if (!code || !todo.dueAt) return;

    const scheduleId = await scheduleReminder(code, todo);

    if (!scheduleId) return;

    /*
     * La planification part sans être attendue, pour que
     * l'ajout d'une tâche reste instantané. Le prix à payer
     * est cette fenêtre : ajouter une tâche puis la
     * supprimer aussitôt, et la réponse du serveur arrive
     * après la suppression — recréant une fiche de rappel
     * pour une tâche qui n'existe plus, qui sonnerait le
     * jour dit.
     *
     * D'où la relecture de l'état courant plutôt que de
     * `todo`, figé au moment de l'appel.
     */

    const current = todosRef.current.find(
      (t) => t.id === todo.id
    );

    if (!current || current.done) {
      cancelReminder(code, todo.id, scheduleId);
      return;
    }

    setTodos((prev) =>
      prev.map((t) =>
        t.id === todo.id ? { ...t, scheduleId } : t
      )
    );
  };

  const dropReminder = (todo: Todo) => {
    const code = getProfileCode();

    if (!code || !todo.dueAt) return;

    cancelReminder(code, todo.id, todo.scheduleId);
  };

  const addTodo = () => {
    const text = draft.trim();

    if (!text) return;

    /*
     * `datetime-local` rend une chaîne sans fuseau
     * (« 2026-08-25T10:30 »). `new Date()` l'interprète en
     * heure locale, ce qui est exactement ce qu'on veut :
     * 10 h 30 chez la pédiatre, pas 10 h 30 UTC.
     */

    const dueAt =
      showDue && dueDraft
        ? new Date(dueDraft).getTime()
        : undefined;

    const todo: Todo = {
      id:
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 6),
      text,
      done: false,
      ...(dueAt && Number.isFinite(dueAt)
        ? { dueAt, offset: offsetDraft }
        : {}),
    };

    setTodos((prev) => [...prev, todo]);

    setDraft('');
    setDueDraft('');
    setShowDue(false);

    if (todo.dueAt) planReminder(todo);

    inputRef.current?.focus();
  };

  /*
   * Cocher une tâche annule son rappel : personne ne veut
   * être notifié d'un rendez-vous déjà honoré. Décocher le
   * replanifie, à condition que l'heure ne soit pas passée.
   */

  const toggleTodo = (id: string) => {
    const todo = todos.find((t) => t.id === id);

    if (!todo) return;

    const nextDone = !todo.done;

    setTodos((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, done: nextDone } : t
      )
    );

    if (!todo.dueAt) return;

    if (nextDone) {
      dropReminder(todo);
    } else if (todo.dueAt > Date.now()) {
      planReminder(todo);
    }
  };

  const removeTodo = (id: string) => {
    const todo = todos.find((t) => t.id === id);

    if (todo?.dueAt) dropReminder(todo);

    setTodos((prev) =>
      prev.filter((t) => t.id !== id)
    );
  };

  /*
   * Export vers le Calendrier. Le fichier est fabriqué dans
   * le navigateur et ouvert directement : sur iOS, cela
   * déclenche la fiche « Ajouter au calendrier », d'où
   * l'alarme partira quoi qu'il arrive du côté du push.
   */

  const exportIcs = (todo: Todo) => {
    if (!todo.dueAt) return;

    /*
     * Le fichier est demandé au serveur plutôt que fabriqué
     * ici. Un lien `download` vers un blob est ignoré par
     * iOS dans une application installée sur l'écran
     * d'accueil — soit exactement le cas où ce bouton sert
     * de recours si le push n'a pas fonctionné.
     *
     * L'heure d'alarme est calculée ici, dans le bon
     * fuseau, et transmise au serveur qui vit en UTC.
     */

    const params = new URLSearchParams({
      id: todo.id,
      text: todo.text,
      due: String(todo.dueAt),
      fire: String(
        computeFireAt(todo.dueAt, todo.offset || 'at')
      ),
    });

    window.location.href = `/api/reminders/ics?${params.toString()}`;
  };

  const remaining = todos.filter((t) => !t.done).length;

  /*
   * Les tâches datées d'abord, dans l'ordre de l'échéance ;
   * les autres après, dans leur ordre d'ajout. Une liste où
   * le rendez-vous de demain se retrouve sous « penser à
   * arroser » n'aide personne.
   */

  const ordered = [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;

    if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt;
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;

    return 0;
  });

  const hasDated = todos.some(
    (t) => t.dueAt && !t.done
  );

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

          {solar && solarAge !== null && (
            <span
              className={
                solarAge > 600
                  ? 'solar-age is-stale'
                  : 'solar-age'
              }
            >
              {formatAge(solarAge)}
            </span>
          )}

        </div>

        {solar ? (
          <>

            <SolarFlow
              production={solar.production}
              consumption={solar.consumption}
              grid={solar.grid}
            />

            <Link href="/solaire" className="solar-more">
              Voir la journée ›
            </Link>

          </>
        ) : (
          <div className="hub-tile-empty">

            <p>
              {solarReady
                ? "Aucun relevé reçu de l'onduleur pour l'instant."
                : 'Lecture du dernier relevé…'}
            </p>

          </div>
        )}

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
            className={
              showDue
                ? 'todo-when is-active'
                : 'todo-when'
            }
            onClick={() => {
              /*
               * Ouvrir sur un champ vide obligerait à
               * composer une date complète au clavier
               * numérique pour la moitié des cas. Demain 9 h
               * est le point de départ le plus souvent juste,
               * et se corrige d'un geste.
               */

              if (!showDue && !dueDraft) {
                const tomorrow = new Date();

                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(9, 0, 0, 0);

                setDueDraft(
                  toLocalInputValue(tomorrow.getTime())
                );
              }

              setShowDue(!showDue);
            }}
            aria-label="Ajouter une échéance"
            aria-pressed={showDue}
          >
            ◷
          </button>

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

        {showDue && (
          <div className="todo-due-panel">

            <label className="todo-due-field">

              <span>Échéance</span>

              <input
                type="datetime-local"
                value={dueDraft}
                onChange={(e) =>
                  setDueDraft(e.target.value)
                }
              />

            </label>

            <div className="todo-offset-row">

              {OFFSETS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    offsetDraft === option.value
                      ? 'todo-offset is-active'
                      : 'todo-offset'
                  }
                  onClick={() =>
                    setOffsetDraft(option.value)
                  }
                >
                  {option.label}
                </button>
              ))}

            </div>

          </div>
        )}

        {/*
          La bannière n'apparaît qu'une fois une tâche datée
          créée. Réclamer l'autorisation d'envoyer des
          notifications avant qu'il y ait quoi que ce soit à
          notifier est le meilleur moyen de se la faire
          refuser définitivement.
        */}

        {hasDated &&
          (!hasProfile || pushState !== 'granted') && (
            <div className="todo-push-banner">

              <p>
                {!hasProfile
                  ? 'Les rappels ont besoin d’un identifiant de profil : choisis-en un dans le menu.'
                  : pushState === 'needs-install'
                  ? 'Pour être prévenu, ajoute le Hub à ton écran d’accueil : Partager, puis « Sur l’écran d’accueil ».'
                  : pushState === 'denied'
                  ? 'Notifications refusées. Réactive-les dans Réglages, puis reviens ici.'
                  : pushState === 'unsupported'
                  ? 'Ce navigateur ne gère pas les notifications. L’export calendrier reste disponible sur chaque tâche.'
                  : 'Active les notifications pour recevoir tes rappels.'}
              </p>

              {hasProfile && pushState === 'default' && (
                <button
                  type="button"
                  className="todo-push-button"
                  onClick={activatePush}
                  disabled={pushBusy}
                >
                  {pushBusy ? 'Activation…' : 'Activer'}
                </button>
              )}

            </div>
          )}

        {pushMessage && (
          <p className="todo-push-message">
            {pushMessage}
          </p>
        )}

        {todos.length === 0 ? (
          <p className="todo-empty">
            Rien de prévu pour l&apos;instant.
          </p>
        ) : (
          <ul className="todo-list">

            {ordered.map((todo) => (
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

                <span className="todo-body">

                  <span className="todo-text">
                    {todo.text}
                  </span>

                  {todo.dueAt && (
                    <span
                      className={
                        !todo.done &&
                        isOverdue(todo.dueAt)
                          ? 'todo-due is-late'
                          : 'todo-due'
                      }
                    >
                      {formatDue(todo.dueAt)}
                      <em>
                        {offsetLabel(todo.offset)}
                      </em>
                    </span>
                  )}

                </span>

                {todo.dueAt && (
                  <button
                    type="button"
                    className="todo-ics"
                    onClick={() => exportIcs(todo)}
                    aria-label="Ajouter au calendrier"
                    title="Ajouter au calendrier"
                  >
                    ▦
                  </button>
                )}

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

    </main>
  );
}
