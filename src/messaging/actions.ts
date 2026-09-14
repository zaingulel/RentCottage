"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/routing";

import { createRequestMessagingRuntime } from "./request-messaging-runtime";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestReference = /^RC-REQ-[A-F0-9]{16}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function startMessagingConversation(value: unknown) {
  const input = record(value);
  if (
    !input ||
    typeof input.publicSlug !== "string" ||
    !/^cottage-[0-9a-f]{32}$/.test(input.publicSlug) ||
    typeof input.commandId !== "string" ||
    !uuid.test(input.commandId)
  ) {
    return { status: "invalid" as const };
  }
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) return { status: "unavailable" as const };
    return await runtime.messaging.createConversationForCottage(
      input.publicSlug,
      input.commandId,
    );
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function openBookingMessagingConversation(value: unknown) {
  const input = record(value);
  if (
    !input ||
    typeof input.bookingRequestReference !== "string" ||
    !requestReference.test(input.bookingRequestReference) ||
    typeof input.commandId !== "string" ||
    !uuid.test(input.commandId)
  ) {
    return { status: "invalid" as const };
  }
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) return { status: "unavailable" as const };
    return await runtime.messaging.openBookingConversation(
      input.bookingRequestReference,
      input.commandId,
    );
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function sendMessagingMessage(value: unknown) {
  const input = record(value);
  if (
    !input ||
    typeof input.locale !== "string" ||
    !isLocale(input.locale) ||
    typeof input.conversationId !== "string" ||
    !uuid.test(input.conversationId) ||
    typeof input.commandId !== "string" ||
    !uuid.test(input.commandId) ||
    typeof input.originalBody !== "string" ||
    typeof input.originalLanguage !== "string" ||
    !isLocale(input.originalLanguage)
  ) {
    return { status: "invalid" as const };
  }
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) return { status: "unavailable" as const };
    const result = await runtime.messaging.send({
      conversationId: input.conversationId,
      commandId: input.commandId,
      originalLanguage: input.originalLanguage,
      originalBody: input.originalBody,
    });
    if (result.status === "sent") {
      revalidatePath(`/${input.locale}/messages/${input.conversationId}`);
      revalidatePath(`/${input.locale}/messages`);
    }
    return result;
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function translateMessagingMessage(value: unknown) {
  const input = record(value);
  if (
    !input ||
    typeof input.locale !== "string" ||
    !isLocale(input.locale) ||
    typeof input.messageId !== "string" ||
    !uuid.test(input.messageId) ||
    typeof input.targetLanguage !== "string" ||
    !isLocale(input.targetLanguage)
  ) {
    return { status: "invalid" as const };
  }
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) return { status: "unavailable" as const };
    const result = await runtime.translation.translate(
      input.messageId,
      input.targetLanguage,
    );
    if (result.status === "translated") {
      revalidatePath(`/${input.locale}/messages`);
    }
    return result;
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function reportMessagingTranslation(value: unknown) {
  const input = record(value);
  if (
    !input ||
    typeof input.translationId !== "string" ||
    !uuid.test(input.translationId) ||
    typeof input.commandId !== "string" ||
    !uuid.test(input.commandId) ||
    typeof input.category !== "string" ||
    !["incorrect", "unclear", "inappropriate"].includes(input.category)
  ) {
    return { status: "invalid" as const };
  }
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) return { status: "unavailable" as const };
    return await runtime.translation.report(
      input.translationId,
      input.commandId,
      input.category as "incorrect" | "unclear" | "inappropriate",
    );
  } catch {
    return { status: "unavailable" as const };
  }
}
