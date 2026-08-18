'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import {
  getProfileCode,
  pullProfile,
  pushProfile,
} from '@/lib/profile';

/*
 * =========================================================
 * SYNCHRONISATION AUTOMATIQUE
 *
 * Au montage : si un profil est lié, on récupère l'état
 * du serveur avant d'afficher quoi que ce soit — ainsi
 * chaque page lit déjà les bonnes données au premier rendu.
 *
 * En arrière-plan / fermeture : on pousse l'état local.
 * Pas de synchronisation à chaque frappe, uniquement à ces
 * points de bascule naturels.
 * =========================================================
 */

const PULL_TIMEOUT = 3000;

export default function ProfileGate({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const code = getProfileCode();

    if (!code) {
      setReady(true);
      return;
    }

    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };

    /* Ne bloque jamais l'app plus de 3 secondes */
    const timeout = setTimeout(finish, PULL_TIMEOUT);

    pullProfile(code).finally(() => {
      clearTimeout(timeout);
      finish();
    });
  }, []);

  useEffect(() => {
    const handlePush = () => {
      const code = getProfileCode();

      if (code) pushProfile(code);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        handlePush();
      }
    };

    document.addEventListener(
      'visibilitychange',
      handleVisibility
    );

    window.addEventListener('pagehide', handlePush);

    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibility
      );

      window.removeEventListener(
        'pagehide',
        handlePush
      );
    };
  }, []);

  if (!ready) {
    return (
      <div className="profile-gate-loading">
        <span className="loader large" />
      </div>
    );
  }

  return <>{children}</>;
}
