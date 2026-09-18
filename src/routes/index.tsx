import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Menu, Play, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import heroImage from "@/assets/shanime-hero.jpg";
import cursedPoster from "@/assets/poster-cursed.jpg";
import zeroPoster from "@/assets/poster-zero.jpg";
import magePoster from "@/assets/poster-mage.jpg";
import erasedPoster from "@/assets/poster-erased.jpg";

// No head() here: the home route inherits title/description/og/twitter from
// __root.tsx, and ships no og:image so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "shanime | Anime keşfi" },
      { name: "description", content: "Sezonun öne çıkan anime serilerini keşfet ve yeni favorini bul." },
      { property: "og:title", content: "shanime | Anime keşfi" },
      { property: "og:description", content: "Sezonun öne çıkan anime serilerini keşfet ve yeni favorini bul." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// IMPORTANT: Replace this placeholder. See ./README.md for routing conventions.
const shows = [
  { title: "Jujutsu Kaisen", subtitle: "Lanetler, büyücüler ve büyük bir hesaplaşma", image: cursedPoster },
  { title: "Re:Zero", subtitle: "Başka bir dünyada sıfırdan başlamak", image: zeroPoster },
  { title: "Mushoku Tensei", subtitle: "İkinci bir hayat, sınırsız bir dünya", image: magePoster },
  { title: "Erased", subtitle: "Geçmişe uzanan karanlık bir gizem", image: erasedPoster },
];

const genres = ["Tüm seriler", "Aksiyon", "Bilim kurgu", "Dram", "Fantastik", "Komedi", "Gizem"];

function Index() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = shows.filter((show) => show.title.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-5 px-5 lg:px-8">
          <a href="#top" aria-label="shanime ana sayfa" className="flex items-center gap-2 font-display text-2xl text-foreground"><span className="grid size-9 place-items-center rounded-full border-2 border-accent text-sm text-primary">▶</span>shanime</a>
          <nav aria-label="Ana navigasyon" className="hidden items-center gap-8 md:flex">
            <a href="#top" className="text-sm font-extrabold text-accent">Ana sayfa</a>
            <a href="#series" className="text-sm font-bold text-muted-foreground transition-colors hover:text-foreground">Seriler</a>
            <a href="#season" className="text-sm font-bold text-muted-foreground transition-colors hover:text-foreground">Bu sezon</a>
          </nav>
          <div className="relative hidden items-center gap-3 md:flex">
            <Button variant="ghost" size="icon" className="rounded-full bg-secondary" aria-label="Anime ara" onClick={() => setSearchOpen((open) => !open)}><Search size={18} /></Button>
            <Button onClick={() => document.querySelector("#genres")?.scrollIntoView({ behavior: "smooth" })}>Keşfet</Button>
            {searchOpen && <div className="absolute right-16 top-14 w-80 rounded-3xl border border-border bg-popover p-4 shadow-2xl"><div className="flex items-center gap-2 rounded-full border-2 border-primary px-4"><Search size={17} className="text-muted-foreground" /><label className="sr-only" htmlFor="search">Anime ara</label><input id="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Anime ara..." className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div><div className="mt-3 space-y-1">{(query ? filtered : shows).map((show) => <a href="#series" key={show.title} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary"><img src={show.image} alt="" width={40} height={52} className="h-12 w-9 rounded-md object-cover" /><span><strong className="block text-sm">{show.title}</strong><span className="text-xs text-muted-foreground">Anime · Seri</span></span></a>)}</div></div>}
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menüyü aç" onClick={() => setMenuOpen((open) => !open)}><Menu size={21} /></Button>
        </div>
        {menuOpen && <nav className="flex flex-col border-t border-border px-5 py-4 md:hidden"><a className="py-3 font-bold text-primary" href="#top">Ana sayfa</a><a className="py-3 font-bold" href="#series">Seriler</a><a className="py-3 font-bold" href="#season">Bu sezon</a></nav>}
      </header>

      <main id="top">
        <section className="relative isolate min-h-[520px] overflow-hidden border-b border-border md:min-h-[620px]">
          <img src={heroImage} alt="Kırmızı lanet enerjisi kullanan genç büyücü" width={1536} height={864} className="absolute inset-0 -z-20 size-full object-cover object-center" fetchPriority="high" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/70 to-background/25" />
          <div className="mx-auto flex min-h-[520px] max-w-7xl items-end px-5 py-14 md:min-h-[620px] md:items-center lg:px-8">
            <div className="max-w-xl animate-rise-in">
              <p className="mb-3 inline-flex rounded-full border border-border bg-secondary px-3 py-1 text-xs font-extrabold text-muted-foreground">Popüler animeler</p>
              <p className="mb-2 text-sm font-bold text-muted-foreground">Öne çıkan seri</p>
              <h1 className="font-display text-5xl leading-none text-accent sm:text-7xl">JUJUTSU<br />KAISEN</h1>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground"><span className="rounded-full border border-border bg-background px-3 py-1">2020</span><span className="rounded-full border border-border bg-background px-3 py-1">2 Sezon</span><span className="rounded-full border border-border bg-background px-3 py-1">Aksiyon</span></div>
              <p className="mt-5 max-w-lg text-sm leading-7 text-foreground md:text-base">Lanetli enerjiyle örülü bir dünyada, genç bir büyücü her savaştan sonra kendine biraz daha yaklaşır.</p>
              <Button variant="hero" size="lg" className="mt-7 rounded-full"><Play size={17} fill="currentColor" /> Şimdi izle</Button>
            </div>
          </div>
        </section>

        <section id="season" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <div className="mb-8 flex items-end justify-between"><div><p className="text-sm font-extrabold text-primary">Yeni seçkiler</p><h2 className="mt-1 font-display text-3xl text-foreground">Bu sezon</h2></div><a href="#series" className="group flex items-center gap-2 text-sm font-extrabold">Tümünü gör <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" /></a></div>
          <div id="series" className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {(query ? filtered : shows).map((show) => <article key={show.title} className="group overflow-hidden rounded-3xl bg-card shadow-2xl"><div className="aspect-[2/3] overflow-hidden bg-muted"><img src={show.image} alt={`${show.title} kapak görseli`} width={768} height={1152} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" /></div><div className="p-4"><h3 className="text-base font-extrabold text-foreground">{show.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{show.subtitle}</p></div></article>)}
          </div>
          {query && filtered.length === 0 && <p className="py-16 text-center text-muted-foreground">Aramana uygun seri bulunamadı.</p>}
        </section>

        <section className="border-y border-border bg-background"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-[1fr_1.4fr] lg:px-8"><div><p className="text-sm font-extrabold text-primary">Hızlı seçim</p><h2 className="mt-1 font-display text-3xl">En çok izlenenler</h2><p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">Kısa, kolay taranan bir liste. Haftanın en çok ilgi gören serilerini hemen yakala.</p></div><ol className="divide-y divide-border rounded-3xl bg-card px-6">{[["01","Transit Echo","24,8K izlenme"],["02","Fox Protocol","19,2K izlenme"],["03","Night Market","14,7K izlenme"]].map(([n,name,count]) => <li key={n} className="flex items-center gap-5 py-5"><span className="font-display text-3xl text-primary">{n}</span><div><p className="font-extrabold">{name}</p><p className="mt-1 text-xs text-muted-foreground">Kurgusal seri · {count}</p></div></li>)}</ol></div></section>

        <section id="genres" className="mx-auto max-w-7xl px-5 py-16 lg:px-8"><div className="rounded-3xl bg-card p-8 md:p-12"><p className="text-sm font-extrabold text-primary">Rotanı seç</p><h2 className="mt-1 font-display text-3xl">Türlere göre keşfet</h2><p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">Şehir haritası gibi açılan türler arasında kaybolmadan bir sonraki serini bul.</p><div className="mt-8 flex flex-wrap gap-3">{genres.map((genre) => <a key={genre} href="#series" className="rounded-lg border border-border px-5 py-3 text-sm font-bold transition-colors hover:border-accent hover:text-accent">{genre}</a>)}</div></div></section>
      </main>

      <footer className="border-t border-border bg-secondary text-foreground"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-3 lg:px-8"><div><p className="font-display text-2xl">sh<span className="text-primary">a</span>nime</p><p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">Yeni serini bul. Tüm başlıklar ve görseller tasarım ön izlemesi amacıyla hazırlanmıştır.</p></div><div><p className="text-sm font-extrabold">Platform</p><div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground"><a href="#series">Tüm seriler</a><a href="#season">Bu sezon</a><a href="#series">Yeni bölümler</a></div></div><div><p className="text-sm font-extrabold">Destek</p><div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground"><a href="#top">İçerik politikası</a><a href="#top">Telif bildirimi</a><a href="#top">Yardım merkezi</a></div></div></div><div className="border-t border-border px-5 py-5 text-center text-xs text-muted-foreground">© 2026 shanime · Anime keşfi için tasarlanmıştır.</div></footer>
    </div>
  );
}
