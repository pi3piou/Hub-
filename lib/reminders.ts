/*
 * =========================================================
 * RAPPELS — MODÈLE PARTAGÉ
 *
 * Ce fichier est lu par le navigateur ET par le serveur.
 * Rien de spécifique à l'un ou à l'autre n'a le droit d'y
 * entrer : ni `crypto`, ni `localStorage`.
 * =========================================================
 */

export type ReminderOffset =
  | 'at'
  | '15m'
  | '1h'
  | 'eve';

export interface Todo {
  id: string;
  text: string;
  done: boolean;

  /*
   * Tout ce qui suit est facultatif, et doit le rester :
   * les tâches enregistrées avant cette version n'ont
   * aucun de ces champs et doivent continuer à s'afficher
   * sans migration ni perte.
   */

  /* Horodatage de l'échéance, en millisecondes. */
  dueAt?: number;

  offset?: ReminderOffset;

  /*
   * Identifiant du message planifié chez QStash. Sert
   * uniquement à l'annuler si la tâche est cochée ou
   * supprimée avant l'heure.
   */
  scheduleId?: string;
}

export const OFFSETS: {
  value: ReminderOffset;
  label: string;
}[] = [
  { value: 'at', label: 'À l’heure' },
  { value: '15m', label: '15 min avant' },
  { value: '1h', label: '1 h avant' },
  { value: 'eve', label: 'La veille, 19 h' },
];

/*
 * L'heure à laquelle la notification doit partir, déduite
 * de l'échéance et du décalage choisi.
 *
 * « La veille » est un cas à part : ce n'est pas une
 * soustraction, c'est une date différente. Vingt-quatre
 * heures en arrière depuis un rendez-vous à 8 h du matin
 * donnerait un rappel à 8 h la veille, ce qui n'est pas ce
 * que veut dire « la veille au soir ».
 */

export function computeFireAt(
  dueAt: number,
  offset: ReminderOffset
) {
  if (offset === 'eve') {
    const eve = new Date(dueAt);

    eve.setDate(eve.getDate() - 1);
    eve.setHours(19, 0, 0, 0);

    return eve.getTime();
  }

  if (offset === '15m') return dueAt - 15 * 60_000;
  if (offset === '1h') return dueAt - 60 * 60_000;

  return dueAt;
}

export function offsetLabel(offset?: ReminderOffset) {
  const found = OFFSETS.find(
    (o) => o.value === offset
  );

  return found ? found.label : 'À l’heure';
}

/* =========================================================
   AFFICHAGE
   ========================================================= */

export function formatDue(dueAt: number) {
  const date = new Date(dueAt);

  const now = new Date();

  const sameDay =
    date.toDateString() === now.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isTomorrow =
    date.toDateString() === tomorrow.toDateString();

  const time = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (sameDay) return `Aujourd’hui ${time}`;
  if (isTomorrow) return `Demain ${time}`;

  return (
    date.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }) + ` ${time}`
  );
}

export function isOverdue(dueAt: number) {
  return dueAt < Date.now();
}

/*
 * Valeur pour un `<input type="datetime-local">`, qui
 * n'accepte que l'heure locale sans fuseau — donc pas
 * `toISOString()`, qui renverrait de l'UTC et décalerait
 * l'affichage de une ou deux heures selon la saison.
 */

export function toLocalInputValue(ts: number) {
  const d = new Date(ts);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}` + `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/* =========================================================
   EXPORT VERS LE CALENDRIER (.ics)
   ========================================================= */

/*
 * Le secours. Le push dépend d'une chaîne un peu longue —
 * autorisation accordée, service worker vivant, serveur de
 * push d'Apple joignable, app toujours installée. Le
 * Calendrier d'iOS, lui, sonne. Pour un rendez-vous chez
 * la pédiatre, avoir les deux n'est pas de la redondance
 * inutile.
 */

function escapeIcs(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsStamp(ts: number) {
  return (
    new Date(ts)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  );
}

/*
 * Une ligne d'un fichier .ics ne doit pas dépasser 75
 * octets ; au-delà elle se replie sur la suivante,
 * précédée d'une espace. Le découpage se fait bien sur les
 * octets et non sur les caractères : un « é » en compte
 * deux, et couper au milieu casserait le fichier pour les
 * lecteurs les plus stricts.
 */

function foldLine(line: string) {
  const out: string[] = [];

  let current = '';
  let size = 0;

  for (const ch of Array.from(line)) {
    const chSize = charSize(ch);

    if (size + chSize > 73 && current) {
      out.push(current);
      current = ' ';
      size = 1;
    }

    current += ch;
    size += chSize;
  }

  if (current) out.push(current);

  return out.join('\r\n');
}

function charSize(ch: string) {
  const code = ch.codePointAt(0) || 0;

  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;

  return 4;
}

/*
 * `fireAtOverride` existe pour un piège de fuseau horaire.
 * Ce fichier est aussi lu par le serveur, qui vit en UTC :
 * « la veille à 19 h » calculé là-bas donnerait une alarme à
 * 21 h en heure française. L'heure d'envoi est donc toujours
 * calculée dans le navigateur, puis transmise telle quelle.
 */

export function buildIcs(
  todo: Todo,
  fireAtOverride?: number
) {
  if (!todo.dueAt) return null;

  const fireAt =
    fireAtOverride ??
    computeFireAt(todo.dueAt, todo.offset || 'at');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hub//Rappels//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:hub-${todo.id}@hub.local`,
    `DTSTAMP:${icsStamp(Date.now())}`,
    `DTSTART:${icsStamp(todo.dueAt)}`,
    `DTEND:${icsStamp(todo.dueAt + 30 * 60_000)}`,
    `SUMMARY:${escapeIcs(todo.text)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(todo.text)}`,

    /*
     * Déclencheur absolu plutôt que relatif : « la veille
     * à 19 h » ne s'écrit pas en durée avant l'événement,
     * et mélanger les deux formes selon le décalage
     * choisi ferait deux chemins à tester au lieu d'un.
     */
    `TRIGGER;VALUE=DATE-TIME:${icsStamp(fireAt)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
