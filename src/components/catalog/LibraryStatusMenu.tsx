import { useEffect, useState } from "react";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";

import { ControlSelect } from "@/components/site/ControlSelect";
import {
  getLibraryStatus,
  isLibraryStatus,
  setLibraryStatus,
  type LibraryStatus,
} from "@/lib/library";
import { useLang } from "@/lib/i18n";

export function LibraryStatusMenu({ slug }: { slug: string }) {
  const { t } = useLang();
  const [status, setStatus] = useState<LibraryStatus | null>(() => getLibraryStatus(slug));

  useEffect(() => {
    setStatus(getLibraryStatus(slug));
    const sync = () => setStatus(getLibraryStatus(slug));
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [slug]);

  const selectStatus = (key: string) => {
    const next = key === "none" ? null : isLibraryStatus(key) ? key : null;
    setLibraryStatus(slug, next);
    setStatus(next);
  };

  return (
    <div
      className="absolute right-2 top-2 z-20 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ControlSelect
        ariaLabel={t("library.aria")}
        variant="library"
        iconOnly
        triggerIcon={
          status ? (
            <BookmarkCheck size={16} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <BookmarkPlus size={16} strokeWidth={2.2} aria-hidden="true" />
          )
        }
        align="right"
        options={[
          {
            key: "none",
            label: status ? t("library.remove") : t("library.add"),
            active: status === null,
          },
          { key: "watching", label: t("library.watching"), active: status === "watching" },
          {
            key: "completed",
            label: t("library.completed"),
            active: status === "completed",
          },
          { key: "on-hold", label: t("library.onHold"), active: status === "on-hold" },
          { key: "dropped", label: t("library.dropped"), active: status === "dropped" },
          {
            key: "plan-to-watch",
            label: t("library.planToWatch"),
            active: status === "plan-to-watch",
          },
        ]}
        onSelect={selectStatus}
      />
    </div>
  );
}
