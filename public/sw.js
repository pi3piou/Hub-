/*
 * =========================================================
 * SERVICE WORKER — RAPPELS
 *
 * Ce fichier ne met rien en cache. C'est délibéré : la
 * seule raison de sa présence est de pouvoir réveiller
 * l'application quand elle est fermée, ce que le service
 * worker est le seul à savoir faire.
 *
 * Mettre les pages en cache ici transformerait un bug de
 * rappel en bug d'affichage figé, avec une version périmée
 * de l'app servie hors ligne et un débogage bien plus
 * pénible. Si un mode hors ligne devient utile un jour, il
 * mérite son propre fichier et sa propre décision.
 * =========================================================
 */

self.addEventListener('install', () => {
  /*
   * On saute l'attente : sans cela, un service worker mis à
   * jour reste « en attente » tant qu'un onglet de l'ancienne
   * version est ouvert. Sur un téléphone où l'app n'est
   * jamais vraiment fermée, la nouvelle version pourrait ne
   * jamais prendre la main.
   */
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * ARRIVÉE D'UN RAPPEL
 *
 * `showNotification` doit être appelé à tous les coups, y
 * compris si la charge utile est illisible : un navigateur
 * qui reçoit un push sans voir de notification apparaître
 * peut révoquer l'autorisation d'envoi. D'où la
 * notification de repli plutôt qu'un retour silencieux.
 */

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || 'Rappel';

  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'hub-rappel',

    /*
     * `renotify` sans `tag` est ignoré ; avec, il fait
     * vibrer à nouveau si une notification du même
     * rappel était déjà affichée.
     */
    renotify: true,
    requireInteraction: false,
    data: {
      url: data.url || '/',
      todoId: data.todoId || null,
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/*
 * CLIC SUR LA NOTIFICATION
 *
 * On cherche d'abord une fenêtre déjà ouverte sur
 * l'application pour la ramener au premier plan, au lieu
 * d'en ouvrir une deuxième. Ouvrir systématiquement un
 * nouvel onglet laisserait l'utilisateur avec plusieurs
 * copies du Hub après quelques rappels.
 */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target =
    (event.notification.data &&
      event.notification.data.url) ||
    '/';

  event.waitUntil(
    self.clients
      .matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(target).catch(() => {});
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }

        return undefined;
      })
  );
});
