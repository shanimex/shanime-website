import { supabase } from "@/integrations/supabase/client";

export type Show = {
  id: string;
  title: string;
  subtitle: string;
  image_path: string;
  sort_order: number;
  slug: string | null;
  description: string;
  year: string;
  genre: string;
  watch_url: string;
};

export type Episode = {
  id: string;
  show_id: string;
  number: number;
  title: string;
  summary: string;
  duration: string;
  watch_url: string;
};

export type Character = {
  id: string;
  show_id: string;
  name: string;
  role: string;
  image_path: string;
  sort_order: number;
};

export type GalleryImage = {
  id: string;
  show_id: string;
  image_path: string;
  caption: string;
  sort_order: number;
};

export type ShowWithImage = Show & { image: string };

const BUCKET = "images";
const SIGNED_URL_TTL = 60 * 60; // 1 saat

export async function signImagePath(path: string): Promise<string> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function fetchShows(): Promise<ShowWithImage[]> {
  const { data, error } = await db.from("shows").select("*").order("sort_order", { ascending: true });
  if (error || !data) return [];
  const shows = data as Show[];
  const urls = await Promise.all(shows.map((s) => signImagePath(s.image_path)));
  return shows.map((s, i) => ({ ...s, image: urls[i] ?? "" }));
}

export async function fetchHeroImage(): Promise<string | null> {
  const { data, error } = await db.from("site_settings").select("value").eq("key", "hero_image").maybeSingle();
  if (error || !data?.value) return null;
  return signImagePath(data.value as string);
}

export async function uploadImage(file: File, folder: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await db.from("user_roles").select("id").eq("user_id", userId).eq("role", "admin").maybeSingle();
  return Boolean(data);
}

export function showSlug(show: Pick<Show, "id" | "slug">): string {
  return show.slug && show.slug.trim() ? show.slug : show.id;
}

export type ShowDetail = {
  show: ShowWithImage;
  episodes: Episode[];
  characters: (Character & { image: string })[];
  gallery: (GalleryImage & { image: string })[];
};

export async function fetchShowDetail(slug: string): Promise<ShowDetail | null> {
  const bySlug = await db.from("shows").select("*").eq("slug", slug).maybeSingle();
  let show = bySlug.data as Show | null;
  if (!show) {
    const byId = await db.from("shows").select("*").eq("id", slug).maybeSingle();
    show = (byId.data as Show | null) ?? null;
  }
  if (!show) return null;

  const [episodesRes, charactersRes, galleryRes, cover] = await Promise.all([
    db.from("show_episodes").select("*").eq("show_id", show.id).order("number", { ascending: true }),
    db.from("show_characters").select("*").eq("show_id", show.id).order("sort_order", { ascending: true }),
    db.from("show_images").select("*").eq("show_id", show.id).order("sort_order", { ascending: true }),
    signImagePath(show.image_path),
  ]);

  const characters = (charactersRes.data ?? []) as Character[];
  const gallery = (galleryRes.data ?? []) as GalleryImage[];
  const [charUrls, galleryUrls] = await Promise.all([
    Promise.all(characters.map((c) => (c.image_path ? signImagePath(c.image_path) : Promise.resolve("")))),
    Promise.all(gallery.map((g) => signImagePath(g.image_path))),
  ]);

  return {
    show: { ...show, image: cover },
    episodes: ((episodesRes.data ?? []) as Episode[]),
    characters: characters.map((c, i) => ({ ...c, image: charUrls[i] ?? "" })),
    gallery: gallery.map((g, i) => ({ ...g, image: galleryUrls[i] ?? "" })),
  };
}
