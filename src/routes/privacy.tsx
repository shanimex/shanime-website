import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy | shanime" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { lang } = useLang();
  const tr = lang === "tr";
  const sections = tr
    ? [
        [
          "Hesap ve Google ile giriş",
          "E-posta ile kayıt olurken e-posta adresinizi ve seçtiğiniz kullanıcı adını işleriz. Google ile girişte Google hesap kimliği, e-posta adresi, ad ve varsa profil resmi alınır. Bu bilgiler Supabase aracılığıyla hesap oluşturmak, girişinizi doğrulamak ve oturumunuzu sürdürmek için kullanılır. Google şifrenizi almayız; Gmail, Drive veya rehber erişimi istemeyiz.",
        ],
        [
          "Cihazınızdaki kayıtlar",
          "Oturum bilgileri, dil tercihi, izleme ilerlemesi ve mevcut yerel yorum özelliğinin kayıtları tarayıcınızın yerel depolamasında tutulabilir. Yerel kayıtlar cihazlar arasında otomatik eşitlenmez. Tarayıcı verilerini silmeniz bu kayıtları silebilir ve oturumunuzu kapatabilir.",
        ],
        [
          "Hizmet sağlayıcılar ve gömülü içerik",
          "Kimlik doğrulama için Supabase, site sunumu ve kötüye kullanım koruması için Cloudflare kullanılır. Bu hizmetler IP adresi, tarayıcı/cihaz bilgisi ve teknik günlükleri kendi politikaları doğrultusunda işleyebilir. Harici video oynatıcıları ve etkin reklam hizmetleri kendi çerezlerini veya depolamalarını kullanabilir. Bu hizmetlere bağlandığınızda IP adresiniz ve teknik istek bilgileriniz onlara iletilebilir; ayrı gizlilik politikaları geçerlidir.",
        ],
        [
          "Google verilerinin kullanımı",
          "Google girişinden aldığımız profil ve e-posta verilerini hesap/giriş işlevleri için kullanırız; bu verileri satmayız veya kişiselleştirilmiş reklam hedefleme amacıyla aktarmayız. Google verilerinin kullanımı ve diğer uygulamalara aktarımı, Limited Use gereklilikleri dahil Google API Services User Data Policy ile uyumlu olmalıdır.",
        ],
        [
          "Saklama, güvenlik ve silme talepleri",
          "Hesap bilgileri hesabı işletmek için gerektiği sürece saklanır. Güvenlik veya hukuki yükümlülükler bazı kayıtların daha uzun saklanmasını gerektirebilir. Verilerinize erişim, düzeltme veya hesabınızın silinmesi talebi için shanime.co@outlook.com adresine yazın. Hesap sahipliğini doğrulamamız gerekebilir. Google hesabınızın bağlantılı uygulamalar ayarından izni kaldırabilirsiniz; bu işlem Shanime'deki mevcut hesabı kendiliğinden silmez. Yerel tarayıcı kayıtlarını ayrıca temizleyebilirsiniz.",
        ],
      ]
    : [
        [
          "Accounts and Google sign-in",
          "For email registration we process your email address and chosen username. Google sign-in provides a Google account identifier, email address, name and profile picture, if available. Supabase processes these details to create your account, authenticate sign-in and maintain your session. We do not receive your Google password or request access to Gmail, Drive or contacts.",
        ],
        [
          "Storage on your device",
          "Session information, language preferences, viewing progress and records from the current local comments feature may be stored in your browser's local storage. Local records are not automatically synchronized across devices. Clearing browser data may remove them and sign you out.",
        ],
        [
          "Service providers and embedded content",
          "We use Supabase for authentication and Cloudflare for site delivery and abuse protection. These services may process IP addresses, browser/device details and technical logs under their own policies. External video players and active advertising services may use their own cookies or storage. Connecting to these services may disclose your IP address and technical request information to them; their separate privacy policies apply.",
        ],
        [
          "Use of Google data",
          "We use Google profile and email data for account and sign-in functionality. We do not sell this data or transfer it for personalized advertising. Use of information received from Google APIs and transfer to other apps must adhere to the Google API Services User Data Policy, including its Limited Use requirements.",
        ],
        [
          "Retention, security and deletion requests",
          "Account information is retained as needed to operate your account. Security or legal obligations may require retaining some records longer. To request access, correction or account deletion, contact shanime.co@outlook.com. We may need to verify account ownership. You can revoke access in your Google Account's connected-app settings; revoking access does not automatically delete an existing Shanime account. You can separately clear local browser records.",
        ],
      ];
  return (
    <div className="info-page route-enter">
      <main className="info-page-main">
        <h1 className="info-page-title">{tr ? "Gizlilik Politikası" : "Privacy Policy"}</h1>
        <article className="info-page-card">
          <p>
            {tr
              ? "Son güncelleme: 16 Ekim 2026. Bu politika shanime.xyz için geçerlidir."
              : "Last updated: October 16, 2026. This policy applies to shanime.xyz."}
          </p>
          {sections.map(([title, text]) => (
            <section key={title} className="info-page-section">
              <h2>{title}</h2>
              <div className="info-page-section-body">
                <p>{text}</p>
              </div>
            </section>
          ))}
          <p>
            <a className="info-page-link" href="mailto:shanime.co@outlook.com">
              shanime.co@outlook.com
            </a>
          </p>
          <p>
            <a
              className="info-page-link"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
