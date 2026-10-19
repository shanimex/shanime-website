import { createFileRoute } from "@tanstack/react-router";

import { InfoPage } from "@/components/site/InfoPage";
import { t as translate } from "@/lib/i18n";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [{ title: `${translate("info.termsTitle")} | shanime` }],
  }),
  component: () => <InfoPage kind="terms" />,
});
