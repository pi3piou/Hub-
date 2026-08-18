'use client';

import { useEffect, useRef, useState } from 'react';

import {
  clearProfileCode,
  generateProfileCode,
  getProfileCode,
  pullProfile,
  pushProfile,
  setProfileCode,
} from '@/lib/profile';

type Status = 'idle' | 'working' | 'success' | 'error';

export default function ProfileCard() {
  const [code, setCode] = useState<string | null>(
    null
  );

  const [joinInput, setJoinInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const statusTimer = useRef<number | null>(null);

  useEffect(() => {
    setCode(getProfileCode());
  }, []);

  const flashStatus = (
    nextStatus: Status,
    text: string
  ) => {
    setStatus(nextStatus);
    setMessage(text);

    if (statusTimer.current) {
      window.clearTimeout(statusTimer.current);
    }

    statusTimer.current = window.setTimeout(() => {
      setStatus('idle');
    }, 3000);
  };

  const handleCreate = async () => {
    const newCode = generateProfileCode();

    setProfileCode(newCode);
    setCode(newCode);

    setStatus('working');

    const ok = await pushProfile(newCode);

    flashStatus(
      ok ? 'success' : 'error',
      ok
        ? 'Profil créé et synchronisé.'
        : 'Profil créé, mais l’envoi a échoué.'
    );
  };

  const handleJoin = async () => {
    const value = joinInput.trim().toUpperCase();

    if (!/^[A-Z0-9]{4,10}$/.test(value)) {
      flashStatus('error', 'Code invalide.');
      return;
    }

    setStatus('working');

    setProfileCode(value);

    const ok = await pullProfile(value);

    if (!ok) {
      clearProfileCode();

      flashStatus(
        'error',
        'Impossible de récupérer ce profil.'
      );

      return;
    }

    flashStatus('success', 'Profil rejoint.');

    /*
     * Les données locales viennent d'être remplacées :
     * un rechargement garantit que chaque page affiche
     * le nouvel état plutôt qu'un état déjà lu en
     * mémoire par des composants montés.
     */
    window.setTimeout(
      () => window.location.reload(),
      600
    );
  };

  const handlePull = async () => {
    if (!code) return;

    setStatus('working');

    const ok = await pullProfile(code);

    if (!ok) {
      flashStatus(
        'error',
        'Échec de la récupération.'
      );

      return;
    }

    flashStatus('success', 'Données à jour.');

    window.setTimeout(
      () => window.location.reload(),
      600
    );
  };

  const handlePush = async () => {
    if (!code) return;

    setStatus('working');

    const ok = await pushProfile(code);

    flashStatus(
      ok ? 'success' : 'error',
      ok ? 'Données envoyées.' : 'Échec de l’envoi.'
    );
  };

  const handleUnlink = () => {
    if (
      !window.confirm(
        'Délier ce profil ? Cet appareil garde ses données locales mais ne se synchronisera plus.'
      )
    ) {
      return;
    }

    clearProfileCode();
    setCode(null);
  };

  const handleCopy = async () => {
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);

      setCopied(true);

      window.setTimeout(
        () => setCopied(false),
        2000
      );
    } catch {
      // Le code reste affiché, copie manuelle possible
    }
  };

  return (
    <section className="profile-card">

      <div className="section-header">

        <div>
          <span className="section-eyebrow">
            PROFIL
          </span>

          <h2>
            {code
              ? 'Synchronisation'
              : 'Multi-appareils'}
          </h2>
        </div>

      </div>

      {!code ? (
        <div className="profile-setup">

          <p>
            Relie tes appareils pour retrouver la même
            progression sur iPad et iPhone.
          </p>

          <button
            className="primary-button profile-create"
            onClick={handleCreate}
          >
            Créer un profil
          </button>

          <div className="profile-divider">
            <span>ou</span>
          </div>

          <div className="profile-join">

            <input
              value={joinInput}
              onChange={(event) =>
                setJoinInput(
                  event.target.value.toUpperCase()
                )
              }
              placeholder="Code à 6 caractères"
              maxLength={10}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />

            <button
              className="profile-join-button"
              onClick={handleJoin}
              disabled={status === 'working'}
            >
              Rejoindre
            </button>

          </div>

        </div>
      ) : (
        <div className="profile-linked">

          <div className="profile-code-row">

            <div className="profile-code">
              {code}
            </div>

            <button
              className="profile-copy"
              onClick={handleCopy}
            >
              {copied ? 'Copié' : 'Copier'}
            </button>

          </div>

          <p>
            Saisis ce code sur ton autre appareil pour
            les relier.
          </p>

          <div className="profile-actions">

            <button
              className="profile-action"
              onClick={handlePull}
              disabled={status === 'working'}
            >
              ↓ Récupérer
            </button>

            <button
              className="profile-action"
              onClick={handlePush}
              disabled={status === 'working'}
            >
              ↑ Envoyer
            </button>

          </div>

          <button
            className="profile-unlink"
            onClick={handleUnlink}
          >
            Délier cet appareil
          </button>

        </div>
      )}

      {status !== 'idle' && (
        <p className={`profile-status is-${status}`}>
          {status === 'working'
            ? 'Synchronisation…'
            : message}
        </p>
      )}

    </section>
  );
}
