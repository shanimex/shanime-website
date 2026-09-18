import { supabase } from "@/integrations/supabase/client";

export type Show = {
  id: string;
  title: string;
  subtitle: string;
  image_path: string;
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
