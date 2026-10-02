/**
 * Plasmic test rotası (`/plasmic-test`) — 02.10.2026.
 *
 * Plasmic Studio'da çizilen "Homepage" bileşeni burada görünür. Çalışırsa
 * istenen gerçek rotaya taşınır; çalışmazsa bu dosya silinir, site etkilenmez.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PlasmicComponent, PlasmicRootProvider } from "@plasmicapp/loader-react";

import { PLASMIC } from "@/lib/plasmic";

export const Route = createFileRoute("/plasmic-test")({
  loader: async () => {
    await PLASMIC.fetchComponentData("Homepage");
    return null;
  },
  component: PlasmicTest,
});

function PlasmicTest() {
  // Sağlayıcı YALNIZCA bu rotada: ana siteye dokunmaz.
  return (
    <PlasmicRootProvider loader={PLASMIC}>
      <PlasmicComponent component="Homepage" />
    </PlasmicRootProvider>
  );
}
