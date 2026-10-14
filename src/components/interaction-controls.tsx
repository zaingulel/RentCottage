import Link from "next/link";
import type {
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { ActionFocusTarget } from "./action-button";

export {
  ActionButton,
  ActionFocusTarget,
  prepareActionFocusNavigation,
} from "./action-button";

function withoutKind<Props extends { kind: string }>(props: Props) {
  const nativeProps = { ...props };
  Reflect.deleteProperty(nativeProps, "kind");
  return nativeProps as Omit<Props, "kind">;
}

type ActionLinkProps = Omit<
  ComponentProps<typeof Link>,
  "aria-pressed" | "children" | "className" | "href"
> &
  (
    | {
        kind: "primary" | "secondary";
        width?: "full";
        href: string;
        children: ReactNode;
      }
    | { kind: "text"; href: string; children: ReactNode }
  );

export function ActionLink(props: ActionLinkProps) {
  if (props.kind === "text") {
    const linkProps = withoutKind(props);
    return <Link {...linkProps} className="action-link action-text" />;
  }

  const { kind, width = "content", ...linkProps } = props;
  return (
    <Link
      {...linkProps}
      className={`action-link action-${kind} action-${width}`}
    />
  );
}

type FormControlProps =
  | ({ kind: "input" } & Omit<
      InputHTMLAttributes<HTMLInputElement>,
      "className"
    >)
  | ({ kind: "select" } & Omit<
      SelectHTMLAttributes<HTMLSelectElement>,
      "className"
    >)
  | ({ kind: "textarea" } & Omit<
      TextareaHTMLAttributes<HTMLTextAreaElement>,
      "className"
    >);

export function FormControl(props: FormControlProps) {
  if (props.kind === "input") {
    const inputProps = withoutKind(props);
    return <input {...inputProps} className="form-control" />;
  }
  if (props.kind === "select") {
    const selectProps = withoutKind(props);
    return <select {...selectProps} className="form-control" />;
  }
  const textareaProps = withoutKind(props);
  return <textarea {...textareaProps} className="form-control" />;
}

type ChoiceControlProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "className" | "type"
> & {
  kind: "checkbox" | "radio";
  children: ReactNode;
};

export function ChoiceControl({
  kind,
  children,
  ...inputProps
}: ChoiceControlProps) {
  return (
    <label className="choice-control">
      <input {...inputProps} type={kind} />
      <span>{children}</span>
    </label>
  );
}

export function OptionGroup({
  legend,
  layout,
  children,
}: {
  legend: ReactNode;
  layout: "stack" | "wrap";
  children: ReactNode;
}) {
  return (
    <fieldset className={`option-group option-group-${layout}`}>
      <legend>{legend}</legend>
      <div>{children}</div>
    </fieldset>
  );
}

export function Disclosure({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="disclosure">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export function ActionFeedback({
  kind,
  children,
  focusTargetId,
}: {
  kind: "success" | "error";
  children: ReactNode;
  focusTargetId?: string;
}) {
  return (
    <p
      role={kind === "success" ? "status" : "alert"}
      id={focusTargetId}
      tabIndex={focusTargetId ? -1 : undefined}
      className={`action-feedback action-feedback-${kind}${focusTargetId ? " action-focus-target" : ""}`}
    >
      <span aria-hidden="true">{kind === "success" ? "✓" : "!"}</span>{" "}
      {children}
      {focusTargetId && <ActionFocusTarget targetId={focusTargetId} />}
    </p>
  );
}
