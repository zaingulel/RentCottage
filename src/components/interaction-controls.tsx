import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed" | "children" | "className"
> & {
  children: ReactNode;
};

function withoutKind<Props extends { kind: string }>(props: Props) {
  const nativeProps = { ...props };
  Reflect.deleteProperty(nativeProps, "kind");
  return nativeProps as Omit<Props, "kind">;
}

type ActionButtonProps =
  | (NativeButtonProps & {
      kind: "primary";
      width: "content" | "full";
      pending?: boolean;
    })
  | (NativeButtonProps & {
      kind: "secondary";
      width?: "content" | "full";
      size: "compact" | "regular";
      pending?: boolean;
    })
  | (NativeButtonProps & {
      kind: "toggle";
      pressed: boolean;
      size: "compact" | "regular";
    });

export function ActionButton(props: ActionButtonProps) {
  if (props.kind === "toggle") {
    const { pressed, size, ...buttonProps } = withoutKind(props);
    return (
      <button
        {...buttonProps}
        aria-pressed={pressed}
        className={`action action-toggle action-${size}`}
      />
    );
  }

  if (props.kind === "secondary") {
    const {
      pending = false,
      width = "content",
      size,
      ...buttonProps
    } = withoutKind(props);
    return (
      <button
        {...buttonProps}
        aria-busy={pending || undefined}
        className={`action action-secondary action-${size} action-${width}`}
        disabled={buttonProps.disabled || pending}
      />
    );
  }

  const { pending = false, width, ...buttonProps } = withoutKind(props);
  return (
    <button
      {...buttonProps}
      aria-busy={pending || undefined}
      className={`action action-primary action-regular action-${width}`}
      disabled={buttonProps.disabled || pending}
    />
  );
}

type ActionLinkProps = Omit<
  ComponentProps<typeof Link>,
  "aria-pressed" | "children" | "className" | "href"
> &
  (
    | {
        kind: "primary" | "secondary";
        width: "content" | "full";
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

  const { kind, width, ...linkProps } = props;
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

export function ActionFeedback({
  kind,
  children,
}: {
  kind: "success" | "error";
  children: ReactNode;
}) {
  return (
    <p
      role={kind === "success" ? "status" : "alert"}
      className={`action-feedback action-feedback-${kind}`}
    >
      <span aria-hidden="true">{kind === "success" ? "✓" : "!"}</span>{" "}
      {children}
    </p>
  );
}
