'use client';

import { useState, useEffect } from 'react';
import {
  loadSources, saveSources, applySourceColors, makeSource,
  loadAppName, saveAppName, loadTabMode, saveTabMode,
} from '@/lib/techfeed/prefs';

/*
 * Le theme est celui de tout le hub, pas seulement de la
 * section News : meme cle de stockage et meme attribut que le
 * bouton de la barre d'Anime Stream, sinon les deux se
 * contrediraient d'une page a l'autre.
 *
 * Le mode "auto" a ete retire : le script anti-scintillement
 * du layout, qui applique le theme avant le premier rendu, ne
 * sait relire qu'un choix explicite.
 */

const THEME_KEY = 'anime_theme';

const THEMES = [
  { id: 'light', label: 'Clair' },
  { id: 'dark', label: 'Sombre' },
];

const SIZES = [
  { id: 'small', label: 'Petit', px: 14 },
  { id: 'medium', label: 'Moyen', px: 16 },
  { id: 'large', label: 'Grand', px: 18 },
  { id: 'xlarge', label: 'Énorme', px: 21 },
];

const SWATCHES = [
  '#2f7bf6', '#0ea5e9', '#14b8a6', '#22c55e',
  '#eab308', '#f08b2c', '#ef4444', '#ec4899',
  '#8b5cf6', '#6366f1', '#64748b', '#111827',
];

export function applyTheme(choice) {
  document.documentElement.setAttribute(
    'data-theme',
    choice === 'light' ? 'light' : 'dark'
  );
}

export function applyFontSize(id) {
  const found = SIZES.find((s) => s.id === id) || SIZES[1];
  document.documentElement.style.setProperty('--reader-font-size', found.px + 'px');
}

export default function Drawer({ onSourcesChange, onOpenSource, onPrefsChange }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('root');
  const [theme, setTheme] = useState('dark');
  const [fontSize, setFontSize] = useState('medium');
  const [sources, setSources] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [appName, setAppNameState] = useState('TechFeed');
  const [tabMode, setTabModeState] = useState('name');

  useEffect(() => {
    const savedTheme =
      localStorage.getItem(THEME_KEY) === 'light'
        ? 'light'
        : 'dark';
    const savedSize = localStorage.getItem('techfeed-font-size') || 'medium';
    setTheme(savedTheme);
    setFontSize(savedSize);
    applyTheme(savedTheme);
    applyFontSize(savedSize);
    setSources(loadSources());
    setAppNameState(loadAppName());
    setTabModeState(loadTabMode());

    /*
     * Le menu lateral du hub demande l'ouverture par un
     * evenement du navigateur. Il vit dans un autre arbre
     * React : un evenement est le lien le plus simple entre
     * les deux, sans etat partage a maintenir.
     */

    function onExternalOpen() {
      setView('sources');
      setOpen(true);
    }

    window.addEventListener(
      'techfeed:open-drawer',
      onExternalOpen
    );

    return () => {
      window.removeEventListener(
        'techfeed:open-drawer',
        onExternalOpen
      );
    };
  }, []);

  function commitSources(list) {
    setSources(list);
    saveSources(list);
    applySourceColors(list);
    if (onSourcesChange) onSourcesChange(list);
  }

  function chooseTheme(id) {
    setTheme(id);
    localStorage.setItem(THEME_KEY, id);
    applyTheme(id);
  }

  function chooseSize(id) {
    setFontSize(id);
    localStorage.setItem('techfeed-font-size', id);
    applyFontSize(id);
  }

  function changeAppName(value) {
    setAppNameState(value);
    saveAppName(value);
    if (onPrefsChange) onPrefsChange(value, tabMode);
  }

  function changeTabMode(mode) {
    setTabModeState(mode);
    saveTabMode(mode);
    if (onPrefsChange) onPrefsChange(appName, mode);
  }

  function toggleFavorite(id) {
    commitSources(sources.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s)));
  }

  function setColor(id, color) {
    commitSources(sources.map((s) => (s.id === id ? { ...s, color } : s)));
  }
  
  function setIcon(id, iconUrl) {
    commitSources(sources.map((s) => (s.id === id ? { ...s, iconUrl } : s)));
  }

  function removeSource(id) {
    commitSources(sources.filter((s) => s.id !== id));
  }

  async function addSource() {
    const value = newUrl.trim();
    if (!value) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch('/api/discover?url=' + encodeURIComponent(value));
      const data = await res.json();
      if (!res.ok || !data.feedUrl) {
        setAddError(data.error || 'Flux introuvable');
      } else if (sources.some((s) => s.url === data.feedUrl)) {
        setAddError('Cette source est déjà ajoutée');
      } else {
        const used = new Set(sources.map((s) => s.color));
        const color = SWATCHES.find((c) => !used.has(c)) || '#64748b';
        commitSources([...sources, makeSource({ name: data.name, url: data.feedUrl, color })]);
        setNewUrl('');
      }
    } catch (e) {
      setAddError('Impossible de contacter le site');
    }
    setAdding(false);
  }

  function close() {
    setOpen(false);
    setTimeout(() => {
      setView('root');
      setExpanded(null);
    }, 250);
  }

  return (
    <>
      {/*
        Le bouton d'ouverture est masque en CSS : l'acces se
        fait desormais par le menu lateral du hub. On garde
        l'element plutot que de le supprimer, parce qu'il reste
        le seul chemin utilisable au clavier vers ce tiroir.
      */}
      <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Menu">
        <span />
        <span />
        <span />
      </button>

      <div className={'drawer-backdrop' + (open ? ' visible' : '')} onClick={close} />

      <aside className={'drawer' + (open ? ' open' : '')}>
        {view === 'root' && (
          <div className="drawer-inner">
            <div className="drawer-header">
              <span className="drawer-title">Menu</span>
              <button className="drawer-close" onClick={close} aria-label="Fermer">×</button>
            </div>
            <button className="drawer-item" onClick={() => setView('sources')}>
              <span>Sources</span>
              <span className="drawer-chevron">›</span>
            </button>
            <button className="drawer-item" onClick={() => setView('settings')}>
              <span>Réglages</span>
              <span className="drawer-chevron">›</span>
            </button>
          </div>
        )}

        {view === 'sources' && (
          <div className="drawer-inner">
            <div className="drawer-header">
              <button className="drawer-back" onClick={() => setView('root')} aria-label="Retour">‹</button>
              <span className="drawer-title">Sources</span>
              <button className="drawer-close" onClick={close} aria-label="Fermer">×</button>
            </div>

            <div className="add-source">
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="exemple.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
              <button onClick={addSource} disabled={adding}>
                {adding ? '…' : '+'}
              </button>
            </div>
            {addError && <p className="add-error">{addError}</p>}
            <p className="add-hint">Colle l&apos;adresse d&apos;un site, le flux est trouvé automatiquement.</p>

            {sources.map((s) => (
              <div className="source-row" key={s.id}>
                <div className="source-head">
                  <button
                    className={'star' + (s.favorite ? ' on' : '')}
                    onClick={() => toggleFavorite(s.id)}
                    aria-label="Favori"
                  >
                    {s.favorite ? '★' : '☆'}
                  </button>
                  <span className="source-dot" style={{ background: s.color }} />
                  <button
                    className="source-name"
                    onClick={() => {
                      if (onOpenSource) onOpenSource(s.id);
                      close();
                    }}
                  >
                    {s.name}
                  </button>
                  <button className="source-more" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                    {expanded === s.id ? '▴' : '▾'}
                  </button>
                </div>

                {expanded === s.id && (
                  <div className="source-detail">
                    <div className="swatches">
                      {SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          className={'swatch' + (s.color === hex ? ' active' : '')}
                          style={{ background: hex }}
                          onClick={() => setColor(s.id, hex)}
                          aria-label={hex}
                        />
                      ))}
                    </div>
                    <label className="color-free-row">
                      <span>Couleur libre</span>
                      <span className="color-free" style={{ background: s.color }}>
                        <input type="color" value={s.color} onChange={(e) => setColor(s.id, e.target.value)} />
                      </span>
                    </label>
                                        <div className="icon-field">
                      <span>Icône personnalisée</span>
                      <input
                        type="url"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        placeholder="https://…/icon.png"
                        value={s.iconUrl || ''}
                        onChange={(e) => setIcon(s.id, e.target.value.trim())}
                      />
                    </div>

                    <button className="danger-btn" onClick={() => removeSource(s.id)}>
                      Supprimer cette source
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {view === 'settings' && (
          <div className="drawer-inner">
            <div className="drawer-header">
              <button className="drawer-back" onClick={() => setView('root')} aria-label="Retour">‹</button>
              <span className="drawer-title">Réglages</span>
              <button className="drawer-close" onClick={close} aria-label="Fermer">×</button>
            </div>

            <div className="setting-group">
              <div className="setting-label">Nom de l&apos;application</div>
              <input
                className="text-input"
                type="text"
                value={appName}
                maxLength={20}
                onChange={(e) => changeAppName(e.target.value)}
              />
            </div>

            <div className="setting-group">
              <div className="setting-label">Thème</div>
              <div className="tf-segmented">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={'segment' + (theme === t.id ? ' active' : '')}
                    onClick={() => chooseTheme(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-label">Onglets</div>
              <div className="tf-segmented">
                <button
                  className={'segment' + (tabMode === 'name' ? ' active' : '')}
                  onClick={() => changeTabMode('name')}
                >
                  Noms
                </button>
                <button
                  className={'segment' + (tabMode === 'icon' ? ' active' : '')}
                  onClick={() => changeTabMode('icon')}
                >
                  Icônes
                </button>
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-label">Taille du texte</div>
              <div className="tf-segmented">
                {SIZES.map((s) => (
                  <button
                    key={s.id}
                    className={'segment' + (fontSize === s.id ? ' active' : '')}
                    onClick={() => chooseSize(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="setting-preview">Aperçu du texte des articles à cette taille.</p>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
