import { createFileRoute } from "@tanstack/react-router";

import { InfoPage } from "@/components/site/InfoPage";
import { t as translate } from "@/lib/i18n";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [{ title: `${translate("info.contactTitle")} | shanime` }],
  }),
  component: () => <InfoPage kind="contact" />,
});
