import { useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ActionButton,
  ActionFocusTarget,
  prepareActionFocusNavigation,
  ChoiceControl,
  Disclosure,
  FormControl,
  OptionGroup,
} from "@/components/interaction-controls";

const rootElement = document.getElementById("fixture-root");
if (!rootElement)
  throw new Error("Interaction controls fixture root is missing");

type BusyScenario =
  | "retained"
  | "replacement"
  | "disabled"
  | "immediate"
  | "fieldset"
  | "direct-disabled"
  | "main"
  | "navigation"
  | "ordinary"
  | "abort";

function BusyActionFixture() {
  const [scenario, setScenario] = useState<BusyScenario>("retained");
  const [stage, setStage] = useState<"source" | "interim" | "result">("source");
  const [pending, setPending] = useState(false);
  const [actions, setActions] = useState(0);
  const [elsewhere, setElsewhere] = useState(true);
  const [revision, setRevision] = useState(0);
  Reflect.set(window, "configureBusyAction", (next: BusyScenario) => {
    window.history.replaceState(null, "", "/api/health");
    setScenario(next);
    setStage("source");
    setPending(false);
    setActions(0);
    setElsewhere(true);
    setRevision(0);
  });
  Reflect.set(window, "removeBusyElsewhere", () => setElsewhere(false));
  Reflect.set(window, "replaceBusyContent", () =>
    setRevision((value) => value + 1),
  );
  Reflect.set(window, "requestBusyNavigation", (id: string) => {
    prepareActionFocusNavigation(id);
  });
  async function submit() {
    setActions((count) => count + 1);
    if (scenario === "immediate" || scenario === "abort") {
      if (scenario === "abort")
        Reflect.set(
          window,
          "abortBusyNavigation",
          prepareActionFocusNavigation("busy-source"),
        );
      setStage("interim");
    }
    setPending(true);
    await new Promise<void>((resolve) => {
      Reflect.set(window, "releaseBusyAction", resolve);
    });
    if (scenario === "navigation") prepareActionFocusNavigation("busy-source");
    if (scenario === "navigation" || scenario === "ordinary")
      window.history.replaceState(null, "", "/focus-destination");
    if (scenario === "abort") Reflect.get(window, "abortBusyNavigation")();
    setPending(false);
    setStage("result");
  }
  const removed =
    ((scenario === "immediate" || scenario === "abort") &&
      stage !== "source") ||
    (["replacement", "main", "navigation", "ordinary"].includes(scenario) &&
      stage === "result");
  const resultVisible =
    scenario === "fieldset" ||
    scenario === "direct-disabled" ||
    stage === "result" ||
    (scenario === "immediate" && stage === "interim");
  return (
    <section
      aria-label="Busy action fixture"
      data-scenario={scenario}
      data-stage={stage}
    >
      <main id="busy-landmark" tabIndex={-1} className="action-focus-target">
        {!removed && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <FormControl
              kind="input"
              aria-label="Required fixture value"
              required
              defaultValue="Valid"
            />
            <fieldset disabled={scenario === "fieldset" && pending}>
              {scenario === "fieldset" || scenario === "direct-disabled" ? (
                <ActionButton
                  id="busy-source"
                  kind="toggle"
                  size="regular"
                  pressed={false}
                  disabled={scenario === "direct-disabled" && pending}
                  onClick={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                  focusSuccessorId="busy-result"
                >
                  Save fixture
                </ActionButton>
              ) : (
                <ActionButton
                  id="busy-source"
                  kind="primary"
                  pending={pending}
                  disabled={scenario === "disabled" && stage === "result"}
                  focusSuccessorId={
                    scenario === "main" ? "busy-landmark" : "busy-result"
                  }
                >
                  Save fixture
                </ActionButton>
              )}
            </fieldset>
          </form>
        )}
        {resultVisible && (
          <h2
            id="busy-result"
            tabIndex={-1}
            className="action-focus-target"
            key={revision}
          >
            Result {revision}
          </h2>
        )}
      </main>
      {elsewhere && <FormControl kind="input" aria-label="Busy elsewhere" />}
      <p role="status">Actions: {actions}</p>
      <h1 id="busy-destination" tabIndex={-1} className="action-focus-target">
        Destination
      </h1>
      {(!pending || removed) && (
        <>
          <ActionFocusTarget targetId="busy-result" />
          <ActionFocusTarget targetId="busy-landmark" />
        </>
      )}
      <ActionFocusTarget targetId="busy-destination" navigation />
    </section>
  );
}

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
    <BusyActionFixture />
  </>,
);
