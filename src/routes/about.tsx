import { createFileRoute } from "@tanstack/react-router";

import { InfoPage } from "@/components/site/InfoPage";
import { t as translate } from "@/lib/i18n";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [{ title: `${translate("info.aboutTitle")} | shanime` }],
  }),
  component: () => <InfoPage kind="about" />,
});
