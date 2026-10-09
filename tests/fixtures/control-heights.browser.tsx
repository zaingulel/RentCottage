import { createRoot } from "react-dom/client";

import { CottageDiscoveryForm } from "@/components/cottage-discovery-form";
import { FormControl } from "@/components/interaction-controls";

const rootElement = document.getElementById("fixture-root");
if (!rootElement) throw new Error("Control heights fixture root is missing");

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
