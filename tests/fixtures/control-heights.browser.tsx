import { useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { CottageDiscoveryForm } from "@/components/cottage-discovery-form";
import { FormControl } from "@/components/interaction-controls";
import type { Locale } from "@/i18n/routing";

declare global {
  interface Window {
    discoveryHydration: {
      hydrate: () => void;
      recoverableErrors: string[];
      pushes: string[];
    };
  }
}

const rootElement = document.getElementById("fixture-root");
if (!rootElement) throw new Error("Control heights fixture root is missing");

function HydrationFixture({ locale }: { locale: Locale }) {
  useEffect(() => {
    rootElement!.dataset.hydrationCommitted = "true";
  }, []);
  return (
    <CottageDiscoveryForm
      locale={locale}
      facets={{
        status: "loaded",
        governorates: ["Fictional Governorate"],
        areas: ["Fictional Area"],
        amenities: ["pool"],
      }}
    />
  );
}

const hydrationLocale = rootElement.dataset.hydrationLocale as
  | Locale
  | undefined;
if (hydrationLocale) {
  const tree = <HydrationFixture locale={hydrationLocale} />;
  rootElement.innerHTML = renderToString(tree);
  window.discoveryHydration = {
    recoverableErrors: [],
    pushes: [],
    hydrate: () => {
      hydrateRoot(rootElement, tree, {
        onRecoverableError: (error) => {
          window.discoveryHydration.recoverableErrors.push(String(error));
        },
      });
    },
  };
} else {
  createRoot(rootElement).render(
    <>
      <FormControl kind="input" type="file" aria-label="Evidence document" />
      <CottageDiscoveryForm
        locale="en"
        facets={{
          status: "loaded",
          governorates: ["Fictional Governorate"],
          areas: ["Fictional Area"],
          amenities: ["Fictional Amenity"],
        }}
      />
    </>,
  );
}
