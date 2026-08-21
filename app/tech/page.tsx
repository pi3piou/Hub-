import FeedList from '@/components/techfeed/FeedList';

/*
 * Section News. Toute la logique vit dans FeedList, repris du
 * projet Techfeed : cette page ne fait que lui donner son
 * enveloppe de mise en page.
 *
 * La classe `tech-page` porte ce qui etait auparavant applique
 * a l'element `main` lui-meme. Dans le hub, `main` est aussi
 * celui de l'accueil et d'Anime Stream : styler l'element nu
 * aurait deborde sur les deux autres sections.
 */

export default function TechPage() {
  return (
    <main className="tech-page">
      <FeedList />
    </main>
  );
}
