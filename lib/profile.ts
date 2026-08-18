/*
 * =========================================================
 * PROFIL — SYNCHRONISATION MULTI-APPAREILS
 *
 * Règle acceptée : pas de fusion, pas de résolution de
 * conflit. Au chargement, l'appareil récupère l'état du
 * serveur et écrase son état local. En arrière-plan, il
 * pousse son état local vers le serveur. Le dernier
 * appareil qui pousse a raison, point final.
 *
 * Ce qui est synchronisé : favoris, historique, reprise
 * de lecture, épisodes vus, progression par saison.
 * Ce qui NE l'est PAS : les caches (fiches, épisodes,
 * planning, AniList, TMDB) — re-générables à volonté,
 * aucune raison de voyager entre appareils.
 * =========================================================
 */

const PROFILE_CODE_KEY = 'anime_profile_code';

const EXACT_KEYS = ['anime_favorites', 'anime_history'];

const PREFIXES = [
  'anime_continue_',
  'anime_watched_',
  'anime_progress_',
];

function isSyncedKey(key: string) {
  return (
    EXACT_KEYS.includes(key) ||
    PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/* =========================================================
   CODE DE PROFIL
   ========================================================= */

export function getProfileCode(): string | null {
  try {
    return localStorage.getItem(PROFILE_CODE_KEY);
  } catch {
    return null;
  }
}

export function setProfileCode(code: string) {
  try {
    localStorage.setItem(
      PROFILE_CODE_KEY,
      code.trim().toUpperCase()
    );
  } catch {
    // Rien
  }
}

export function clearProfileCode() {
  try {
    localStorage.removeItem(PROFILE_CODE_KEY);
  } catch {
    // Rien
  }
}

/*
 * Lettres et chiffres sans ambiguïté visuelle
 * (pas de 0/O, pas de 1/I/L).
 */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateProfileCode() {
  let code = '';

  for (let i = 0; i < 6; i++) {
    code +=
      CODE_CHARS[
        Math.floor(Math.random() * CODE_CHARS.length)
      ];
  }

  return code;
}

/* =========================================================
   COLLECTE ET APPLICATION DES DONNÉES
   ========================================================= */

function collectSyncedData(): Record<string, string> {
  const data: Record<string, string> = {};

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (!key || !isSyncedKey(key)) continue;

      const value = localStorage.getItem(key);

      if (value !== null) data[key] = value;
    }
  } catch {
    // localStorage indisponible
  }

  return data;
}

/*
 * Remplace l'état local par l'état reçu : les clés
 * absentes du serveur sont supprimées localement, pas
 * seulement les clés présentes qui sont écrasées. C'est
 * ce qui permet à une suppression (favori retiré,
 * historique effacé) de bien se propager.
 */
function applySyncedData(data: Record<string, string>) {
  try {
    const toRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (!key || !isSyncedKey(key)) continue;

      if (!(key in data)) toRemove.push(key);
    }

    toRemove.forEach((key) =>
      localStorage.removeItem(key)
    );

    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(key, value);
    }
  } catch {
    // localStorage indisponible
  }
}

/* =========================================================
   RÉSEAU
   ========================================================= */

export async function pullProfile(
  code: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/profile?code=${encodeURIComponent(code)}`
    );

    if (!response.ok) return false;

    const json = await response.json();

    /* Profil vide (première connexion) : rien à appliquer */
    if (!json.data) return true;

    applySyncedData(json.data);

    return true;
  } catch {
    return false;
  }
}

export async function pushProfile(
  code: string
): Promise<boolean> {
  try {
    const data = collectSyncedData();

    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, data }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
