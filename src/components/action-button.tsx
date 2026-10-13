"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import type {
  ButtonHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  ReactNode,
  Ref,
} from "react";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed" | "children" | "className"
> & {
  children: ReactNode;
  focusSuccessorId?: string;
  ref?: Ref<HTMLButtonElement>;
};

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

type ActionFocusIntent = {
  source: HTMLButtonElement;
  sourceId: string;
  successorId?: string;
  originPathname: string;
  navigationRequested: boolean;
  dispose: () => void;
};

let focusIntent: ActionFocusIntent | null = null;

function captureActionFocus(source: HTMLButtonElement, successorId?: string) {
  if (document.activeElement !== source || source.matches(":disabled")) return;
  focusIntent?.dispose();
  const intent: ActionFocusIntent = {
    source,
    sourceId: source.id,
    successorId,
    originPathname: window.location.pathname,
    navigationRequested: false,
    dispose: () => {
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("popstate", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      if (focusIntent === intent) focusIntent = null;
    },
  };
  function cancel() {
    intent.dispose();
  }
  function onFocus(event: FocusEvent) {
    if (
      event.target === source ||
      (intent.successorId &&
        event.target === document.getElementById(intent.successorId))
    )
      return;
    if (
      event.target === document.body &&
      (!source.isConnected || source.matches(":disabled"))
    )
      return;
    cancel();
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "Tab") cancel();
  }
  function onPointer(event: PointerEvent) {
    if (!source.contains(event.target as Node)) cancel();
  }
  focusIntent = intent;
  document.addEventListener("focusin", onFocus, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("popstate", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("pagehide", cancel);
  return intent;
}

function restoreActionFocus(
  intent: ActionFocusIntent,
  allowDisabledSuccessor = false,
) {
  if (
    focusIntent !== intent ||
    intent.navigationRequested ||
    (intent.source.isConnected &&
      intent.source.getAttribute("aria-busy") === "true")
  )
    return;
  if (intent.source.isConnected && !intent.source.matches(":disabled")) {
    intent.source.focus();
    return;
  }
  if (intent.source.isConnected && !allowDisabledSuccessor) return;
  const successor =
    intent.successorId && document.getElementById(intent.successorId);
  if (
    successor instanceof HTMLElement &&
    successor.isConnected &&
    !successor.matches(":disabled")
  ) {
    successor.focus();
    if (document.activeElement === successor) intent.dispose();
  }
}

export function ActionButton(props: ActionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const keyboardIntent = useRef<ActionFocusIntent | null>(null);
  const {
    onClickCapture,
    onKeyDownCapture,
    focusSuccessorId,
    ref,
    ...actionProps
  } = props;
  const composedRef = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      const cleanup = typeof ref === "function" ? ref(node) : undefined;
      if (ref && typeof ref !== "function") ref.current = node;
      return () => {
        const intent =
          node && focusIntent?.source === node ? focusIntent : null;
        buttonRef.current = null;
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
        if (node && intent)
          queueMicrotask(() => {
            if (!node.isConnected) restoreActionFocus(intent);
          });
      };
    },
    [ref],
  );
  const focusProps = {
    ref: composedRef,
    onKeyDownCapture: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" || event.key === " ")
        keyboardIntent.current =
          captureActionFocus(event.currentTarget, focusSuccessorId) ?? null;
      onKeyDownCapture?.(event);
    },
    onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
      if (
        event.detail !== 0 ||
        !keyboardIntent.current ||
        keyboardIntent.current !== focusIntent
      )
        captureActionFocus(event.currentTarget, focusSuccessorId);
      keyboardIntent.current = null;
      onClickCapture?.(event);
    },
  };
  useLayoutEffect(() => {
    if (focusIntent?.source === buttonRef.current)
      restoreActionFocus(focusIntent);
  });
  if (actionProps.kind === "toggle") {
    const { kind, pressed, size, ...buttonProps } = actionProps;
    return (
      <button
        {...buttonProps}
        {...focusProps}
        aria-pressed={pressed}
        className={`action action-${kind} action-${size}`}
      />
    );
  }

  if (actionProps.kind === "secondary") {
    const {
      kind,
      pending = false,
      width = "content",
      size,
      ...buttonProps
    } = actionProps;
    return (
      <button
        {...buttonProps}
        {...focusProps}
        aria-busy={pending || undefined}
        className={`action action-${kind} action-${size} action-${width}`}
        disabled={buttonProps.disabled || pending}
      />
    );
  }

  const { kind, pending = false, width, ...buttonProps } = actionProps;
  return (
    <button
      {...buttonProps}
      {...focusProps}
      aria-busy={pending || undefined}
      className={`action action-${kind} action-regular action-${width}`}
      disabled={buttonProps.disabled || pending}
    />
  );
}

export function prepareActionFocusNavigation(buttonId: string): () => void {
  const intent = focusIntent;
  if (!intent || !buttonId || intent.sourceId !== buttonId) return () => {};
  intent.navigationRequested = true;
  return () => {
    if (focusIntent !== intent) return;
    intent.navigationRequested = false;
    restoreActionFocus(intent);
  };
}

export function ActionFocusTarget({
  targetId,
  navigation = false,
}: {
  targetId: string;
  navigation?: boolean;
}): null {
  useLayoutEffect(() => {
    const intent = focusIntent;
    if (!intent) return;
    if (!navigation) {
      if (intent.successorId === targetId) restoreActionFocus(intent, true);
      return;
    }
    if (
      !intent.navigationRequested ||
      window.location.pathname === intent.originPathname
    )
      return;
    const target = document.getElementById(targetId);
    if (
      target instanceof HTMLElement &&
      target.isConnected &&
      !target.matches(":disabled")
    ) {
      intent.dispose();
      target.focus();
    }
  });
  return null;
}
