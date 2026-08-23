import type { Metadata, Viewport } from 'next';
import './globals.css';
import HubMenu from '@/components/HubMenu';
import Navbar from '@/components/Navbar';
import ProfileGate from '@/components/ProfileGate';

export const metadata: Metadata = {
  title: 'Hub',
  description: 'Accueil, actualité tech et anime',
};

/*
 * `maximumScale: 1` désactive le zoom à deux doigts sur toute
 * l'application. C'est un vrai renoncement : le zoom est une
 * échappatoire d'accessibilité, et l'enlever la retire à tout
 * le monde, pas seulement dans les News.
 *
 * On l'assume ici parce que c'est une app personnelle,
 * installée sur l'écran d'accueil, où le pincement accidentel
 * pendant un défilement est bien plus fréquent qu'un besoin
 * réel d'agrandir. Une seule ligne à retirer pour revenir en
 * arrière.
 */

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#050508',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        {/*
          Applique le thème enregistré AVANT le premier
          rendu React, sinon on voit un flash du thème
          sombre par défaut le temps que Navbar s'hydrate.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('anime_theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <ProfileGate>
          {children}
          <HubMenu />
          <Navbar />
        </ProfileGate>
      </body>
    </html>
  );
}
