import { createRoot } from "react-dom/client";

import {
  ActionButton,
  ChoiceControl,
  Disclosure,
  FormControl,
  OptionGroup,
} from "@/components/interaction-controls";

const rootElement = document.getElementById("fixture-root");
if (!rootElement)
  throw new Error("Interaction controls fixture root is missing");

createRoot(rootElement).render(
  <>
    <FormControl kind="input" type="text" aria-label="Reference" />
    <OptionGroup legend="Amenities" layout="wrap">
      <ChoiceControl kind="checkbox" defaultChecked>
        Pool
      </ChoiceControl>
      <ChoiceControl kind="checkbox">Garden</ChoiceControl>
      <ChoiceControl kind="checkbox">Terrace</ChoiceControl>
      <ChoiceControl kind="checkbox" disabled>
        Closed
      </ChoiceControl>
      <ChoiceControl kind="checkbox" aria-invalid="true">
        I confirm that every guest in my party has read and accepts the cottage
        rules and the cancellation terms
      </ChoiceControl>
    </OptionGroup>
    <OptionGroup legend="Enquiry" layout="stack">
      <ChoiceControl kind="radio" name="enquiry" defaultChecked>
        New enquiry
      </ChoiceControl>
      <ChoiceControl kind="radio" name="enquiry">
        Continue enquiry
      </ChoiceControl>
    </OptionGroup>
    <Disclosure summary="Filters">
      <p>Optional filters narrow the search.</p>
    </Disclosure>
    <ActionButton kind="toggle" type="button" pressed={false} size="regular">
      Shift 1
    </ActionButton>
    <ActionButton kind="toggle" type="button" pressed size="regular">
      Shift 2
    </ActionButton>
    <ActionButton
      kind="toggle"
      type="button"
      pressed={false}
      size="regular"
      disabled
    >
      Shift 3
    </ActionButton>
    <ActionButton kind="secondary" type="button" size="regular">
      Secondary
    </ActionButton>
  </>,
);
