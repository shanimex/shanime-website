CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS year text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS genre text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS watch_url text NOT NULL DEFAULT '';

UPDATE public.shows SET slug = id::text WHERE slug IS NULL OR slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS shows_slug_key ON public.shows (slug);

CREATE TABLE IF NOT EXISTS public.show_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  number integer NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  duration text NOT NULL DEFAULT '',
  watch_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.show_episodes TO authenticated;
GRANT SELECT ON public.show_episodes TO anon;
GRANT ALL ON public.show_episodes TO service_role;
ALTER TABLE public.show_episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read episodes" ON public.show_episodes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert episodes" ON public.show_episodes FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update episodes" ON public.show_episodes FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete episodes" ON public.show_episodes FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.show_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  image_path text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.show_characters TO authenticated;
GRANT SELECT ON public.show_characters TO anon;
GRANT ALL ON public.show_characters TO service_role;
ALTER TABLE public.show_characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read characters" ON public.show_characters FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert characters" ON public.show_characters FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update characters" ON public.show_characters FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete characters" ON public.show_characters FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.show_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  image_path text NOT NULL,
  caption text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.show_images TO authenticated;
GRANT SELECT ON public.show_images TO anon;
GRANT ALL ON public.show_images TO service_role;
ALTER TABLE public.show_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read show images" ON public.show_images FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert show images" ON public.show_images FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update show images" ON public.show_images FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete show images" ON public.show_images FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_show_episodes_updated_at BEFORE UPDATE ON public.show_episodes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_show_characters_updated_at BEFORE UPDATE ON public.show_characters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();