import { createRoot } from "react-dom/client";
import { SiteHeader, type NavigationAccount } from "@/components/site-header";
import type { Locale } from "@/i18n/routing";

const rootElement = document.getElementById("fixture-root");
if (!rootElement) throw new Error("Site header fixture root is missing");
const root = createRoot(rootElement);

window.renderSiteHeader = ({ locale, account }) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  root.render(<SiteHeader locale={locale} account={account} />);
};

declare global {
  interface Window {
    renderSiteHeader(input: {
      locale: Locale;
      account: NavigationAccount;
    }): void;
  }
}
