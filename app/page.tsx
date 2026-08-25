'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import SolarFlow from '@/components/SolarFlow';
import { getProfileCode } from '@/lib/profile';
import {
  PushState,
  cancelReminder,
  disablePush,
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
const WEATHER_OPEN_KEY = 'hub_weather_open';
const PUSH_SUB_KEY = 'hub_push_subscribed';

type WeatherHour = {
  label: string;
  icon: string;
  temp: number;
  rain: number;
};

type WeatherDay = {
  label: string;
  icon: string;
  max: number;
  min: number;
  rain: number;
};

type ProductionForecast = {
  kwh: number;
  share: number;
  tone: 'belle' | 'faible' | 'neutre';
  label: string | null;
  ceiling: number;
  calibrated: boolean;
};

type Weather = {
  temperature: number;
  feltAs: number;
  label: string;
  icon: string;
  max: number;
  min: number;

  /*
   * Tout ce qui suit est arrivé après coup et reste
   * facultatif : une réponse mise en cache par la version
   * précédente de la route ne les porte pas, et la carte doit
   * continuer à s'afficher sans eux.
   */
  sunrise?: string | null;
  sunset?: string | null;
  hours?: WeatherHour[];
  hoursDay?: 'today' | 'tomorrow';
  days?: WeatherDay[];

  /*
   * Celle du jour reste affichée toute la journée, pour être
   * comparée à la production réelle une fois le soir venu.
   * Celle de demain vient en plus, pas à la place.
   */
  production?: {
    today: ProductionForecast | null;
    tomorrow: ProductionForecast | null;
  } | null;
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

  /*
   * L'état de la carte météo est retenu d'une visite à
   * l'autre : quelqu'un qui la déplie chaque matin ne devrait
   * pas avoir à le refaire. Et au bout d'une semaine, le fait
   * qu'elle soit restée ouverte ou fermée répond tout seul à
   * la question de savoir si la bande horaire valait le coup.
   */

  const [weatherOpen, setWeatherOpen] = useState(false);

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
  const [pushDisabling, setPushDisabling] = useState(false);

  /*
   * `Notification.permission` reste « granted » même après un
   * désabonnement : c'est une autorisation du navigateur, pas
   * un état d'abonnement. Sans ce second indicateur, un
   * appareil désabonné ne réafficherait jamais la bannière
   * d'activation et ses rappels resteraient silencieusement
   * sans destinataire.
   */

  const [subscribed, setSubscribed] = useState(false);

  /*
   * Les rappels voyagent par le profil : c'est lui qui
   * relie un appareil abonné à une tâche. Sans identifiant,
   * la planification n'a nulle part où aller — autant le
   * dire plutôt que de laisser une tâche datée ne jamais
   * sonner sans explication.
   */

  const [hasProfile, setHasProfile] = useState(true);

  /*
   * Édition de l'échéance d'une tâche existante — sans passer
   * par supprimer puis recréer, ce qui perdait le reste de la
   * tâche (et l'historique du rappel) pour un simple
   * changement d'heure.
   */

  const [editingId, setEditingId] = useState<string | null>(
    null
  );

  const [editDueDraft, setEditDueDraft] = useState('');

  const [editOffsetDraft, setEditOffsetDraft] =
    useState<ReminderOffset>('1h');

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

    /*
     * Lu après le montage, comme la date : le serveur n'a pas
     * accès au stockage local, et rendre l'état déplié côté
     * serveur provoquerait une erreur d'hydratation.
     */
    try {
      setWeatherOpen(
        localStorage.getItem(WEATHER_OPEN_KEY) === '1'
      );
    } catch {
      // Stockage indisponible : replié, comme par défaut.
    }
  }, []);

  const toggleWeather = () => {
    const next = !weatherOpen;

    setWeatherOpen(next);

    try {
      localStorage.setItem(
        WEATHER_OPEN_KEY,
        next ? '1' : '0'
      );
    } catch {
      // Rien : l'état vivra le temps de la visite.
    }
  };

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

  /*
   * Le drapeau d'abonnement vit à la fois en mémoire et dans
   * le stockage local : la mémoire pour le rendu immédiat, le
   * stockage pour survivre à un rechargement de la page — sans
   * lui, chaque nouvelle visite oublierait un désabonnement et
   * ferait réapparaître un appareil qui ne devrait plus sonner.
   */

  const markSubscribed = (value: boolean) => {
    setSubscribed(value);

    try {
      if (value) {
        localStorage.setItem(PUSH_SUB_KEY, '1');
      } else {
        localStorage.removeItem(PUSH_SUB_KEY);
      }
    } catch {
      // Rien : l'état vivra le temps de la visite.
    }
  };

  useEffect(() => {
    const state = getPushState();
    const code = getProfileCode();

    setPushState(state);
    setHasProfile(Boolean(code));

    try {
      setSubscribed(
        localStorage.getItem(PUSH_SUB_KEY) === '1'
      );
    } catch {
      // localStorage indisponible : on repartira de « non
      // abonné », quitte à redemander l'activation pour rien.
    }

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
      enablePush(code)
        .then((result) => {
          if (result.ok) markSubscribed(true);
        })
        .catch(() => {
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

      markSubscribed(true);

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
      let lastError: string | undefined;

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

        const { scheduleId, error } =
          await scheduleReminder(code, todo);

        if (!scheduleId) {
          lastError = error;
          continue;
        }

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
          ? `Rappels activés, mais la programmation a échoué${
              lastError ? ` : ${lastError}` : '.'
            } L’export calendrier reste disponible sur chaque tâche.`
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
   * Désabonne cet appareil sans toucher aux tâches ni à leurs
   * échéances : seule la notification s'arrête, l'export
   * calendrier reste disponible comme recours.
   */

  const deactivatePush = async () => {
    const code = getProfileCode();

    if (!code) return;

    setPushDisabling(true);
    setPushMessage(null);

    try {
      const ok = await disablePush(code);

      if (ok) {
        markSubscribed(false);
        setPushMessage(
          'Notifications désactivées sur cet appareil.'
        );
      } else {
        setPushMessage(
          'Désactivation impossible. Réessaie dans un instant.'
        );
      }
    } finally {
      setPushDisabling(false);
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

    const { scheduleId, error } = await scheduleReminder(
      code,
      todo
    );

    if (!scheduleId) {
      /*
       * L'échec est dit, mais sans interrompre : la tâche
       * est créée, sa date s'affiche, et le bouton
       * calendrier reste là. Seule la notification manque.
       */

      if (error) {
        setPushMessage(`Rappel non programmé : ${error}`);
      }

      return;
    }

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

  /*
   * =======================================================
   * ÉDITION D'UNE ÉCHÉANCE EXISTANTE
   *
   * Avant, changer l'heure d'un rendez-vous voulait dire
   * supprimer la tâche et en recréer une — perdant au passage
   * le fait qu'elle avait déjà sonné une fois, ou simplement
   * obligeant à retaper le texte. Le même panneau que pour une
   * nouvelle tâche sert ici, mais ciblé sur une tâche
   * existante via `editingId`.
   * =======================================================
   */

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id);

    if (todo.dueAt) {
      setEditDueDraft(toLocalInputValue(todo.dueAt));
      setEditOffsetDraft(todo.offset || 'at');
      return;
    }

    const tomorrow = new Date();

    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    setEditDueDraft(toLocalInputValue(tomorrow.getTime()));
    setEditOffsetDraft('1h');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    const id = editingId;

    if (!id) return;

    const todo = todosRef.current.find((t) => t.id === id);

    if (!todo) {
      setEditingId(null);
      return;
    }

    const parsed = editDueDraft
      ? new Date(editDueDraft).getTime()
      : NaN;

    const hasNextDue = Number.isFinite(parsed);

    const updated: Todo = {
      ...todo,
      dueAt: hasNextDue ? parsed : undefined,
      offset: hasNextDue ? editOffsetDraft : undefined,
      scheduleId: undefined,
    };

    setTodos((prev) =>
      prev.map((t) => (t.id === id ? updated : t))
    );

    setEditingId(null);

    const code = getProfileCode();
    const previousScheduleId = todo.scheduleId;

    /*
     * Même ordre qu'ailleurs dans ce fichier : on planifie
     * avant d'annuler. Un échec de planification laisse ainsi
     * l'ancien rappel actif plutôt que de tout perdre.
     */

    if (hasNextDue && code) {
      const { scheduleId, error } = await scheduleReminder(
        code,
        updated
      );

      if (scheduleId) {
        if (previousScheduleId) {
          cancelReminder(code, id, previousScheduleId);
        }

        setTodos((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, scheduleId } : t
          )
        );
      } else if (error) {
        setPushMessage(`Rappel non programmé : ${error}`);
      }
    } else if (previousScheduleId && code) {
      cancelReminder(code, id, previousScheduleId);
    }
  };

  /* Retire l'échéance d'un coup, sans passer par le champ de
     date — plus sûr que de compter sur un champ vidé à la
     main, capricieux sur Safari iOS. */

  const removeEditDue = () => {
    const id = editingId;

    if (!id) return;

    const todo = todosRef.current.find((t) => t.id === id);

    if (!todo) {
      setEditingId(null);
      return;
    }

    const updated: Todo = {
      ...todo,
      dueAt: undefined,
      offset: undefined,
      scheduleId: undefined,
    };

    setTodos((prev) =>
      prev.map((t) => (t.id === id ? updated : t))
    );

    setEditingId(null);

    const code = getProfileCode();

    if (todo.scheduleId && code) {
      cancelReminder(code, id, todo.scheduleId);
    }
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

  /*
   * Un seul bloc pour la prévision du jour et celle de demain,
   * plutôt que deux JSX presque identiques à maintenir en
   * double — c'est exactement le genre d'écart qui, copié à
   * la main deux fois, finit par diverger sans qu'on s'en
   * rende compte.
   */

  const forecastBlock = (
    forecast: ProductionForecast,
    when: string,
    variant?: string
  ) => (
    <div
      className={`hub-forecast${
        variant ? ` ${variant}` : ''
      } is-${forecast.tone}`}
    >

      <div className="hub-forecast-text">

        <span className="hub-forecast-when">{when}</span>

        <strong>≈ {forecast.kwh} kWh</strong>

      </div>

      <div
        className="hub-forecast-gauge"
        role="img"
        aria-label={`${Math.round(
          forecast.share * 100
        )} % d’une belle journée de saison`}
      >
        <i
          style={{
            width: `${Math.max(
              3,
              Math.round(forecast.share * 100)
            )}%`,
          }}
        />
      </div>

      {/*
        Le mot n'apparaît qu'aux extrêmes, là où le modèle a
        93 % de justesse. Entre les deux il se tait, et le
        chiffre parle seul.
      */}
      {forecast.label && (
        <span className="hub-forecast-label">
          {forecast.label}
        </span>
      )}

    </div>
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

      <section
        className={
          weather && weatherOpen
            ? 'hub-tile hub-weather is-open'
            : 'hub-tile hub-weather'
        }
      >

        {weather ? (
          <>

            {/*
              La carte entière est le bouton. Une petite
              flèche à toucher serait une cible de quelques
              millimètres au pouce, alors que la surface est
              déjà là et ne sert à rien d'autre.
            */}
            <button
              type="button"
              className="hub-weather-head"
              onClick={toggleWeather}
              aria-expanded={weatherOpen}
              aria-label={
                weatherOpen
                  ? 'Replier la météo'
                  : 'Déplier la météo'
              }
            >

              <span className="hub-weather-icon">
                {weather.icon}
              </span>

              <span className="hub-weather-main">

                <strong>{weather.temperature}°</strong>

                <span>{weather.label}</span>

              </span>

              <span className="hub-weather-side">

                <span>
                  Ressenti {weather.feltAs}°
                </span>

                <span>
                  {weather.min}° / {weather.max}°
                </span>

              </span>

              <span
                className="hub-weather-chevron"
                aria-hidden="true"
              >
                ⌄
              </span>

            </button>

            {/*
              DÉTAIL REPLIÉ PAR DÉFAUT.
              Les trois cartes de l'accueil tiennent tout
              juste sur un écran de téléphone. Déployer la
              bande horaire d'office ferait sortir les tâches
              sous la ligne de flottaison, alors que ce sont
              elles qu'on vient voir en premier.
            */}

            {weatherOpen &&
              weather.hours &&
              weather.hours.length > 0 && (
                <div className="hub-weather-detail">

                  {weather.hoursDay === 'tomorrow' && (
                    <span className="hub-weather-when">
                      Demain
                    </span>
                  )}

                  <div className="hub-hours">

                    {weather.hours.map((h) => (
                      <div
                        className="hub-hour"
                        key={h.label}
                      >

                        <span className="hub-hour-time">
                          {h.label}
                        </span>

                        <span className="hub-hour-icon">
                          {h.icon}
                        </span>

                        <span className="hub-hour-temp">
                          {h.temp}°
                        </span>

                        {/*
                          La barre de pluie est muette sous
                          10 % : une barre à peine visible
                          pour « il ne pleuvra pas » ajoute du
                          bruit sans rien dire.
                        */}
                        <span
                          className="hub-hour-rain"
                          title={`${h.rain} % de pluie`}
                        >
                          <i
                            style={{
                              height:
                                h.rain >= 10
                                  ? `${h.rain}%`
                                  : '0%',
                            }}
                          />
                        </span>

                      </div>
                    ))}

                  </div>

                  {weather.sunrise && weather.sunset && (
                    <div className="hub-sun">
                      <span>↑ {weather.sunrise}</span>
                      <span>↓ {weather.sunset}</span>
                    </div>
                  )}

                  {/*
                    PROCHAINS JOURS — un coup d'œil au-delà de
                    demain. Pas de prévision de production ici :
                    le modèle n'a jamais été validé à plus d'un
                    jour, l'afficher plus loin promettrait une
                    confiance qu'il n'a pas.
                  */}

                  {weather.days && weather.days.length > 0 && (
                    <div className="hub-days">

                      {weather.days.map((d, i) => (
                        <div
                          className="hub-day"
                          key={`${d.label}-${i}`}
                        >

                          <span className="hub-day-label">
                            {d.label}
                          </span>

                          <span className="hub-day-icon">
                            {d.icon}
                          </span>

                          <span className="hub-day-temps">
                            <strong>{d.max}°</strong>
                            <span>{d.min}°</span>
                          </span>

                        </div>
                      ))}

                    </div>
                  )}

                  {/*
                    Prévision de demain — en plus de celle
                    d'aujourd'hui, pas à la place. Réservée au
                    détail déplié : la garder aussi discrète que
                    celle du jour aurait redonné le problème de
                    place qui avait motivé le repli par défaut.
                  */}

                  {weather.production?.tomorrow &&
                    forecastBlock(
                      weather.production.tomorrow,
                      'Demain',
                      'hub-forecast-secondary'
                    )}

                </div>
              )}

            {/*
              PRÉVISION DU JOUR — toujours visible, même replié,
              et toujours celle d'AUJOURD'HUI, matin comme soir :
              c'est ce qui permet de la comparer, une fois la
              journée finie, à ce que les panneaux ont vraiment
              donné.
            */}

            {weather.production?.today &&
              forecastBlock(
                weather.production.today,
                'Aujourd’hui'
              )}

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
          (!hasProfile ||
            pushState !== 'granted' ||
            !subscribed) && (
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

              {hasProfile &&
                (pushState === 'default' ||
                  (pushState === 'granted' &&
                    !subscribed)) && (
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

        {/*
          Contrôle de désabonnement — volontairement discret et
          hors de la bannière, qui ne parle qu'à qui n'est pas
          encore activé. Visible dès que l'appareil est
          effectivement abonné, pas seulement quand il y a une
          tâche datée : on doit pouvoir se désabonner même s'il
          n'y a rien à faire sonner pour l'instant.
        */}

        {hasProfile && pushState === 'granted' && subscribed && (
          <button
            type="button"
            className="todo-push-unsub"
            onClick={deactivatePush}
            disabled={pushDisabling}
          >
            {pushDisabling
              ? 'Désactivation…'
              : 'Désactiver les notifications sur cet appareil'}
          </button>
        )}

        {todos.length === 0 ? (
          <p className="todo-empty">
            Rien de prévu pour l&apos;instant.
          </p>
        ) : (
          <ul className="todo-list">

            {ordered.flatMap((todo) => {
              const row = (
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

                  <button
                    type="button"
                    className={
                      editingId === todo.id
                        ? 'todo-edit is-active'
                        : 'todo-edit'
                    }
                    onClick={() =>
                      editingId === todo.id
                        ? cancelEdit()
                        : startEdit(todo)
                    }
                    aria-label="Modifier l’échéance"
                    aria-pressed={editingId === todo.id}
                    title={
                      todo.dueAt
                        ? 'Modifier l’échéance'
                        : 'Ajouter une échéance'
                    }
                  >
                    ◷
                  </button>

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
              );

              if (editingId !== todo.id) return [row];

              const edit = (
                <li
                  key={`${todo.id}-edit`}
                  className="todo-edit-row"
                >

                  <div className="todo-due-panel">

                    <label className="todo-due-field">

                      <span>Échéance</span>

                      <input
                        type="datetime-local"
                        value={editDueDraft}
                        onChange={(e) =>
                          setEditDueDraft(e.target.value)
                        }
                      />

                    </label>

                    <div className="todo-offset-row">

                      {OFFSETS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            editOffsetDraft === option.value
                              ? 'todo-offset is-active'
                              : 'todo-offset'
                          }
                          onClick={() =>
                            setEditOffsetDraft(option.value)
                          }
                        >
                          {option.label}
                        </button>
                      ))}

                    </div>

                    <div className="todo-edit-actions">

                      {todo.dueAt && (
                        <button
                          type="button"
                          className="todo-edit-remove"
                          onClick={removeEditDue}
                        >
                          Retirer la date
                        </button>
                      )}

                      <button
                        type="button"
                        className="todo-edit-cancel"
                        onClick={cancelEdit}
                      >
                        Annuler
                      </button>

                      <button
                        type="button"
                        className="todo-edit-save"
                        onClick={saveEdit}
                      >
                        Enregistrer
                      </button>

                    </div>

                  </div>

                </li>
              );

              return [row, edit];
            })}

          </ul>
        )}

      </section>

    </main>
  );
}
