'use client';

import { useEffect, useRef, useState } from 'react';

import {
  checkProfileExists,
  clearProfileCode,
  generateProfileCode,
  getProfileCode,
  normalizeProfileCode,
  pullProfile,
  pushProfile,
  setProfileCode,
} from '@/lib/profile';

type Status = 'idle' | 'working' | 'success' | 'error';

export default function ProfileCard() {
  const [code, setCode] = useState<string | null>(
    null
  );

  const [identifierInput, setIdentifierInput] =
    useState('');

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

  const normalizedPreview = normalizeProfileCode(
    identifierInput
  );

  /*
   * Un seul champ, une seule action : si l'identifiant
   * existe déjà, on rejoint ; sinon, on le crée avec
   * l'état actuel de l'appareil.
   */
  const handleContinue = async () => {
    const normalized = normalizedPreview;

    if (normalized.length < 3) {
      flashStatus(
        'error',
        'Identifiant trop court (3 caractères minimum).'
      );

      return;
    }

    setStatus('working');

    const exists = await checkProfileExists(
      normalized
    );

    if (exists === null) {
      flashStatus(
        'error',
        'Connexion impossible, réessaie.'
      );

      return;
    }

    setProfileCode(normalized);

    if (exists) {
      const ok = await pullProfile(normalized);

      if (!ok) {
        clearProfileCode();

        flashStatus(
          'error',
          'Impossible de récupérer ce profil.'
        );

        return;
      }

      setCode(normalized);
      flashStatus('success', 'Profil rejoint.');

      /*
       * Les données locales viennent d'être remplacées :
       * un rechargement garantit que chaque page affiche
       * le nouvel état.
       */
      window.setTimeout(
        () => window.location.reload(),
        600
      );

      return;
    }

    const ok = await pushProfile(normalized);

    setCode(normalized);

    flashStatus(
      ok ? 'success' : 'error',
      ok
        ? 'Profil créé et synchronisé.'
        : 'Profil créé, mais l’envoi a échoué.'
    );
  };

  const handleSuggest = () => {
    setIdentifierInput(generateProfileCode());
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
    setIdentifierInput('');
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
            Choisis un identifiant pour relier tes
            appareils — invente-le, ou retape celui
            d'un autre appareil déjà lié.
          </p>

          <div className="profile-join">

            <input
              value={identifierInput}
              onChange={(event) =>
                setIdentifierInput(
                  event.target.value
                )
              }
              placeholder="ex. pierre-ipad"
              maxLength={30}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleContinue();
                }
              }}
            />

            <button
              className="profile-join-button"
              onClick={handleContinue}
              disabled={status === 'working'}
            >
              Continuer
            </button>

          </div>

          {identifierInput && (
            <small className="profile-preview">
              → {normalizedPreview || '…'}
            </small>
          )}

          <button
            className="text-button profile-suggest"
            onClick={handleSuggest}
          >
            Suggérer un identifiant
          </button>

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
            Retape cet identifiant sur ton autre
            appareil pour les relier.
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
