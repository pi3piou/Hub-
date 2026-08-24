import crypto from 'crypto';

/*
 * =========================================================
 * ENVOI DE NOTIFICATIONS PUSH — SANS DÉPENDANCE
 *
 * La bibliothèque habituelle pour ça s'appelle `web-push`.
 * Elle n'est pas utilisée ici : tout ce qu'elle fait tient
 * dans ce fichier avec le module `crypto` de Node, et une
 * dépendance de moins est une dépendance qui ne casse pas
 * au prochain déploiement.
 *
 * Deux normes se croisent :
 *
 *   RFC 8291 — chiffrement de la charge utile (aes128gcm).
 *     Le serveur de push (Apple, Google) transporte le
 *     message sans jamais pouvoir le lire : seul le
 *     navigateur abonné détient la clé.
 *
 *   RFC 8292 — VAPID. Un jeton signé qui identifie
 *     l'expéditeur auprès du serveur de push. C'est ce qui
 *     permet à Apple de savoir que ce message vient bien du
 *     Hub, et de ne pas le jeter.
 *
 * Les deux paires de clés n'ont rien à voir l'une avec
 * l'autre et c'est la confusion la plus courante ici :
 * VAPID est fixe et identifie le serveur, la paire de
 * chiffrement est éphémère et changée à chaque message.
 * =========================================================
 */

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushResult {
  ok: boolean;
  status: number;

  /*
   * Un abonnement peut mourir sans prévenir : app
   * désinstallée, autorisation retirée, navigateur
   * réinitialisé. Le serveur de push répond alors 404 ou
   * 410, et c'est le seul signal qu'on aura jamais. Sans
   * ce drapeau, la liste d'abonnements se remplirait
   * indéfiniment d'adresses mortes.
   */
  gone: boolean;

  detail?: string;
}

function b64u(buffer: Buffer | Uint8Array) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64u(value: string) {
  return Buffer.from(value, 'base64url');
}

/* HKDF (RFC 5869), réduit à ce dont on a besoin ici. */

function hkdfExtract(salt: Buffer, ikm: Buffer) {
  return crypto
    .createHmac('sha256', salt)
    .update(ikm)
    .digest();
}

function hkdfExpand(
  prk: Buffer,
  info: Buffer,
  length: number
) {
  /*
   * Toutes les sorties demandées ici font 32 octets ou
   * moins, donc un seul tour suffit et le compteur vaut
   * toujours 0x01. Une boucle complète serait du code mort.
   */
  const output = crypto
    .createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest();

  return output.subarray(0, length);
}

/* =========================================================
   JETON VAPID
   ========================================================= */

/*
 * La clé privée VAPID est stockée en base64url — c'est le
 * scalaire `d` de la courbe P-256, rien de plus. Node exige
 * une clé complète pour signer, donc on la reconstruit en
 * lui adjoignant les coordonnées publiques, qu'on a déjà.
 */

function vapidKeyObject(
  publicKey: string,
  privateKey: string
) {
  const pub = fromB64u(publicKey);

  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error(
      'VAPID_PUBLIC_KEY malformée (65 octets non compressés attendus)'
    );
  }

  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: privateKey,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

function vapidHeader(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string
) {
  const audience = new URL(endpoint).origin;

  const header = b64u(
    Buffer.from(
      JSON.stringify({ typ: 'JWT', alg: 'ES256' })
    )
  );

  /*
   * Douze heures. La norme autorise vingt-quatre au
   * maximum et certains serveurs de push refusent tout
   * jeton qui s'en approche de trop près ; la moitié laisse
   * de la marge sans qu'on ait à s'en soucier.
   */

  const payload = b64u(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: subject,
      })
    )
  );

  const signingInput = `${header}.${payload}`;

  /*
   * `ieee-p1363` produit la signature en r||s brut. Sans
   * cette option Node renvoie du DER, que les serveurs de
   * push rejettent silencieusement par un 401.
   */

  const signature = crypto.sign(
    'sha256',
    Buffer.from(signingInput),
    {
      key: vapidKeyObject(publicKey, privateKey),
      dsaEncoding: 'ieee-p1363',
    }
  );

  return `vapid t=${signingInput}.${b64u(
    signature
  )}, k=${publicKey}`;
}

/* =========================================================
   CHIFFREMENT DE LA CHARGE UTILE (RFC 8291)
   ========================================================= */

function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string
) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);

  if (uaPublic.length !== 65) {
    throw new Error('Clé p256dh malformée');
  }

  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  /*
   * Premier HKDF : il mélange le secret ECDH avec le
   * secret d'authentification de l'abonnement, en liant le
   * résultat aux deux clés publiques en présence. C'est ce
   * lien qui empêche de rejouer un message chiffré vers un
   * autre abonné.
   */

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
  ]);

  const ikm = hkdfExpand(
    hkdfExtract(authSecret, sharedSecret),
    keyInfo,
    32
  );

  const salt = crypto.randomBytes(16);
  const prk = hkdfExtract(salt, ikm);

  const cek = hkdfExpand(
    prk,
    Buffer.from('Content-Encoding: aes128gcm\0'),
    16
  );

  const nonce = hkdfExpand(
    prk,
    Buffer.from('Content-Encoding: nonce\0'),
    12
  );

  /*
   * L'octet 0x02 marque la fin du dernier enregistrement.
   * On n'en émet qu'un seul : les charges utiles ici font
   * quelques centaines d'octets, très loin des 4096 qui
   * imposeraient un découpage.
   */

  const plaintext = Buffer.concat([
    Buffer.from(payload, 'utf8'),
    Buffer.from([2]),
  ]);

  const cipher = crypto.createCipheriv(
    'aes-128-gcm',
    cek,
    nonce
  );

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);

  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([asPublic.length]),
    asPublic,
    ciphertext,
  ]);
}

/* =========================================================
   ENVOI
   ========================================================= */

export function pushConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY
  );
}

export async function sendPush(
  subscription: PushSubscription,
  payload: unknown,
  ttlSeconds = 24 * 60 * 60
): Promise<PushResult> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    throw new Error('Clés VAPID absentes');
  }

  /*
   * `sub` doit être une adresse mailto: ou une URL. Apple
   * est le plus regardant des serveurs de push sur ce
   * point et renvoie un 400 sec si le champ est absent ou
   * fantaisiste.
   */

  const subject =
    process.env.VAPID_SUBJECT || 'mailto:hub@localhost';

  const body = encryptPayload(
    JSON.stringify(payload),
    subscription.keys.p256dh,
    subscription.keys.auth
  );

  try {
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidHeader(
          subscription.endpoint,
          publicKey,
          privateKey,
          subject
        ),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        Urgency: 'high',
      },
      body: new Uint8Array(body),
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        gone: false,
      };
    }

    const detail = await response
      .text()
      .catch(() => '');

    return {
      ok: false,
      status: response.status,
      gone:
        response.status === 404 ||
        response.status === 410,
      detail: detail.slice(0, 200),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      gone: false,
      detail:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
