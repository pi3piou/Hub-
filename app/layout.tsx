import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import ProfileGate from '@/components/ProfileGate';

export const metadata: Metadata = {
  title: 'Anime Stream',
  description: 'Anime Stream',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
          <Navbar />
        </ProfileGate>
      </body>
    </html>
  );
}
