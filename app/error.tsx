'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page error-page">
      <div className="error-card">
        <div className="error-icon">!</div>

        <h1>Une erreur est survenue</h1>

        <p>
          L'application a rencontré un problème inattendu.
        </p>

        <button
          onClick={() => reset()}
          className="primary-button"
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}