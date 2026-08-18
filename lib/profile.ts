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
 * L'identifiant est choisi librement par l'utilisateur
 * (pseudo, "pierre-ipad", etc.) plutôt qu'un code imposé
 * à retenir. Il est normalisé en un format simple pour
 * servir de clé de stockage.
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
   IDENTIFIANT DE PROFIL
   ========================================================= */

/*
 * Transforme un texte libre en identifiant sûr pour servir
 * de clé de stockage : minuscules, sans accents, espaces
 * et ponctuation remplacés par des tirets.
 */
export function normalizeProfileCode(input: string) {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

export function getProfileCode(): string | null {
  try {
    return localStorage.getItem(PROFILE_CODE_KEY);
  } catch {
    return null;
  }
}

/*
 * Enregistre l'identifiant tel quel, sans le renormaliser :
 * un identifiant déjà lié (créé avant ce changement, par
 * exemple) continue de fonctionner sans migration.
 */
export function setProfileCode(code: string) {
  try {
    localStorage.setItem(PROFILE_CODE_KEY, code.trim());
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
 * Suggestion pour qui ne veut pas choisir : lettres et
 * chiffres sans ambiguïté visuelle (pas de 0/o, 1/i/l).
 */
const SUGGESTION_CHARS =
  'abcdefghjkmnpqrstuvwxyz23456789';

export function generateProfileCode() {
  let code = '';

  for (let i = 0; i < 8; i++) {
    code +=
      SUGGESTION_CHARS[
        Math.floor(
          Math.random() * SUGGESTION_CHARS.length
        )
      ];
  }

  return code;
}

/* =========================================================
   EXISTENCE D'UN PROFIL
   ========================================================= */

/*
 * true si le profil existe déjà sur le serveur, false s'il
 * est libre, null si la vérification a échoué (réseau).
 */
export async function checkProfileExists(
  code: string
): Promise<boolean | null> {
  try {
    const response = await fetch(
      `/api/profile?code=${encodeURIComponent(code)}`
    );

    if (!response.ok) return null;

    const json = await response.json();

    return json.data !== null && json.data !== undefined;
  } catch {
    return null;
  }
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
