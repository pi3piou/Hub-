import { Todo, computeFireAt } from '@/lib/reminders';

/*
 * =========================================================
 * CÔTÉ NAVIGATEUR — AUTORISATION ET ABONNEMENT
 *
 * Le piège d'iOS, qui explique la moitié de ce fichier :
 * Safari ne propose les notifications web que si le site a
 * été ajouté à l'écran d'accueil. Dans l'onglet ordinaire,
 * `Notification.requestPermission()` échoue sans rien dire
 * d'utile. Il faut donc détecter ce cas et l'expliquer,
 * sinon le bouton « activer » ne fait tout simplement rien
 * et personne ne comprend pourquoi.
 * =========================================================
 */

export type PushState =
  | 'unsupported'
  | 'needs-install'
  | 'default'
  | 'granted'
  | 'denied';

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    /*
     * Un iPad récent se déclare « Macintosh ». L'écran
     * tactile est ce qui le trahit.
     */
    (navigator.platform === 'MacIntel' &&
      navigator.maxTouchPoints > 1)
  );
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)')
      .matches ||
    (window.navigator as { standalone?: boolean })
      .standalone === true
  );
}

export function getPushState(): PushState {
  if (!pushSupported()) {
    /*
     * Sur iPhone hors écran d'accueil, `PushManager`
     * n'existe pas : le manque de support et le manque
     * d'installation se ressemblent, et seul le second se
     * répare.
     */
    return isIOS() && !isStandalone()
      ? 'needs-install'
      : 'unsupported';
  }

  if (isIOS() && !isStandalone()) return 'needs-install';

  const permission = Notification.permission;

  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';

  return 'default';
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;

  try {
    return await navigator.serviceWorker.register(
      '/sw.js',
      { scope: '/' }
    );
  } catch {
    return null;
  }
}

function toUint8Array(base64url: string) {
  const padding = '='.repeat(
    (4 - (base64url.length % 4)) % 4
  );

  const base64 = (base64url + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const raw = atob(base64);

  const output = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }

  return output;
}

async function serverConfig() {
  const response = await fetch('/api/push/subscribe', {
    cache: 'no-store',
  });

  return (await response.json()) as {
    configured: boolean;
    publicKey: string | null;
  };
}

export interface EnableResult {
  ok: boolean;
  state: PushState;
  error?: string;
}

export async function enablePush(
  code: string
): Promise<EnableResult> {
  const state = getPushState();

  if (state === 'needs-install') {
    return {
      ok: false,
      state,
      error:
        'Ajoute d’abord le Hub à ton écran d’accueil : Partager, puis « Sur l’écran d’accueil ».',
    };
  }

  if (state === 'unsupported') {
    return {
      ok: false,
      state,
      error: 'Ce navigateur ne gère pas les notifications.',
    };
  }

  const config = await serverConfig().catch(() => null);

  if (!config?.configured || !config.publicKey) {
    return {
      ok: false,
      state,
      error:
        'Les notifications ne sont pas configurées côté serveur.',
    };
  }

  /*
   * La demande d'autorisation doit partir d'un geste de
   * l'utilisateur. Elle est appelée ici, dans le
   * gestionnaire de clic — la déplacer dans un `useEffect`
   * la ferait refuser d'office par Safari.
   */

  const permission =
    await Notification.requestPermission();

  if (permission !== 'granted') {
    return {
      ok: false,
      state: permission === 'denied' ? 'denied' : 'default',
      error:
        permission === 'denied'
          ? 'Notifications refusées. Réactive-les dans les réglages du téléphone.'
          : 'Autorisation non accordée.',
    };
  }

  const registration = await registerServiceWorker();

  if (!registration) {
    return {
      ok: false,
      state: 'unsupported',
      error: 'Service worker indisponible.',
    };
  }

  /*
   * `ready` attend l'activation. Sans cette attente, le
   * premier abonnement après installation échoue une fois
   * sur deux, en fonction de qui gagne la course.
   */

  const active = await navigator.serviceWorker.ready;

  const existing =
    await active.pushManager.getSubscription();

  const subscription =
    existing ||
    (await active.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8Array(
        config.publicKey
      ),
    }));

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      subscription: subscription.toJSON(),
      label: isIOS() ? 'iPhone' : 'Navigateur',
    }),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .catch(() => ({}));

    return {
      ok: false,
      state: 'granted',
      error:
        detail?.error || 'Abonnement refusé par le serveur.',
    };
  }

  return { ok: true, state: 'granted' };
}

export async function disablePush(code: string) {
  try {
    const registration =
      await navigator.serviceWorker.getRegistration();

    const subscription =
      await registration?.pushManager.getSubscription();

    if (subscription) {
      await fetch(
        `/api/push/subscribe?code=${encodeURIComponent(
          code
        )}&endpoint=${encodeURIComponent(
          subscription.endpoint
        )}`,
        { method: 'DELETE' }
      );

      await subscription.unsubscribe();
    }

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   PLANIFICATION
   ========================================================= */

/*
 * L'heure d'envoi est calculée ici et non sur le serveur :
 * « la veille à 19 h » n'a de sens que dans le fuseau de
 * qui lit. Le serveur, lui, vit en UTC et enverrait le
 * rappel à 21 h en été.
 */

export async function scheduleReminder(
  code: string,
  todo: Todo
): Promise<string | null> {
  if (!todo.dueAt) return null;

  const fireAt = computeFireAt(
    todo.dueAt,
    todo.offset || 'at'
  );

  try {
    const response = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        todoId: todo.id,
        text: todo.text,
        dueAt: todo.dueAt,
        fireAt,
      }),
    });

    const json = await response.json();

    return json?.scheduleId || null;
  } catch {
    return null;
  }
}

export async function cancelReminder(
  code: string,
  todoId: string,
  scheduleId?: string
) {
  try {
    const params = new URLSearchParams({ code, todoId });

    if (scheduleId) params.set('scheduleId', scheduleId);

    await fetch(`/api/reminders?${params.toString()}`, {
      method: 'DELETE',
    });

    return true;
  } catch {
    return false;
  }
}
