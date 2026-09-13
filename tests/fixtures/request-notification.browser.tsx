import { createRoot } from "react-dom/client";
import { RequestNotificationDetails } from "@/components/request-notification-details";
import type { RequestNotificationPresentation } from "@/notification/request-notification-status";
import type { Locale } from "@/i18n/routing";
const root = createRoot(document.getElementById("fixture-root")!);
declare global {
  interface Window {
    showRequestNotices(
      locale: Locale,
      delivery: RequestNotificationPresentation,
    ): void;
  }
}
window.showRequestNotices = (locale, delivery) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  root.render(
    <main>
      <h1>Retained cottage details</h1>
      <p>RC-REQ-0000000000000228</p>
      <RequestNotificationDetails
        locale={locale}
        reference="RC-REQ-0000000000000228"
        delivery={delivery}
      />
    </main>,
  );
};
