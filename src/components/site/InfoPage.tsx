import { Link } from "@tanstack/react-router";
import type { FormEvent, ReactNode } from "react";

import { SiteFooter } from "@/components/site/SiteFooter";
import { useDocumentTitle, useLang } from "@/lib/i18n";

export type InfoPageKind = "about" | "terms" | "contact";

const CONTACT_CENTRE_URL = "https://contact.shanime.xyz";

export function InfoPage({ kind }: { kind: InfoPageKind }) {
  const { t } = useLang();

  const content = {
    about: {
      title: t("info.aboutTitle"),
      lead: t("info.aboutLead"),
    },
    terms: {
      title: t("info.termsTitle"),
      lead: t("info.termsLead"),
    },
    contact: {
      title: t("info.contactTitle"),
      lead: t("info.contactLead"),
    },
  }[kind];

  useDocumentTitle(`${content.title} | shanime`);

  return (
    <div className="info-page route-enter">
      <main className="info-page-main">
        <h1 className="info-page-title">{content.title}</h1>
        <article className="info-page-card">
          {kind !== "contact" && <p>{content.lead}</p>}
          {kind === "about" && <AboutContent />}
          {kind === "terms" && <TermsContent />}
          {kind === "contact" && <ContactContent />}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="info-page-section">
      <h2>{title}</h2>
      <div className="info-page-section-body">{children}</div>
    </section>
  );
}

function AboutContent() {
  const { t } = useLang();

  return (
    <>
      <div className="info-page-paragraphs">
        <p>{t("info.aboutIntroOne")}</p>
        <p>{t("info.aboutIntroTwo")}</p>
        <p>
          {t("info.aboutContactBefore")}
          <Link to="/contact">{t("footer.contact")}</Link>
          {t("info.aboutContactAfter")}
        </p>
      </div>
      <InfoSection title={t("info.aboutDiscoverHeading")}>
        <p>{t("info.aboutDiscoverText")}</p>
        <p>{t("info.aboutAdsText")}</p>
      </InfoSection>
      <InfoSection title={t("info.aboutShareHeading")}>
        <p>{t("info.aboutShareText")}</p>
        <p>{t("info.aboutThanks")}</p>
      </InfoSection>
    </>
  );
}

function TermsContent() {
  const { t } = useLang();
  const sections = [
    ["info.termsAcceptanceHeading", "info.termsAcceptanceText"],
    ["info.termsAccountsHeading", "info.termsAccountsText"],
    ["info.termsConductHeading", "info.termsConductText"],
    ["info.termsModerationHeading", "info.termsModerationText"],
    ["info.termsPrivacyHeading", "info.termsPrivacyText"],
    ["info.termsStorageHeading", "info.termsStorageText"],
    ["info.termsThirdPartyHeading", "info.termsThirdPartyText"],
    ["info.termsCopyrightHeading", "info.termsCopyrightText"],
    ["info.termsLiabilityHeading", "info.termsLiabilityText"],
    ["info.termsChangesHeading", "info.termsChangesText"],
    ["info.termsContactHeading", "info.termsContactText"],
  ] as const;

  return (
    <div className="info-page-terms">
      {sections.map(([heading, text]) => (
        <InfoSection key={heading} title={t(heading)}>
          <p>{t(text)}</p>
          {heading === "info.termsCopyrightHeading" && (
            <Link to="/contact" className="info-page-link">
              {t("info.termsContactAction")}
            </Link>
          )}
        </InfoSection>
      ))}
    </div>
  );
}

function ContactContent() {
  const { t } = useLang();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.open(CONTACT_CENTRE_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <InfoSection title={t("info.contactFormHeading")}>
      <p>{t("info.contactLead")}</p>
      <form className="info-page-form" onSubmit={handleSubmit}>
        <label>
          <span>{t("info.contactEmailLabel")}</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t("info.contactEmailPlaceholder")}
            required
          />
        </label>
        <label>
          <span>{t("info.contactTypeLabel")}</span>
          <select name="type" defaultValue="feedback">
            <option value="feedback">{t("info.contactTypeFeedback")}</option>
            <option value="copyright">{t("info.contactTypeCopyright")}</option>
            <option value="partnership">{t("info.contactTypePartnership")}</option>
          </select>
        </label>
        <label>
          <span>{t("info.contactSubjectLabel")}</span>
          <input
            type="text"
            name="subject"
            placeholder={t("info.contactSubjectPlaceholder")}
            required
          />
        </label>
        <label>
          <span>{t("info.contactMessageLabel")}</span>
          <textarea
            name="message"
            placeholder={t("info.contactMessagePlaceholder")}
            rows={6}
            required
          />
        </label>
        <button type="submit" className="info-page-submit">
          {t("info.contactOpenAction")}
        </button>
      </form>
      <p className="info-page-note">{t("info.contactExternalNote")}</p>
    </InfoSection>
  );
}
