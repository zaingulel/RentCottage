import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasCustomerCapability } from "@/access/account-access";
import { SupabaseAccountContextStore } from "@/access/supabase-account-access";

import { createMessaging, type MessagingRepository } from "./messaging";

export function createRequestMessaging(
  identityClient: SupabaseClient,
  repository: MessagingRepository,
) {
  const messaging = createMessaging(repository);
  const actorUserId = async () => {
    const { data, error } = await identityClient.auth.getUser();
    if (error || !data.user) return undefined;
    const context = await new SupabaseAccountContextStore(
      identityClient,
    ).resolve();
    if (!hasCustomerCapability(context) || context.userId !== data.user.id) {
      return undefined;
    }
    return data.user.id;
  };

  return {
    async createConversation(profileId: string, commandId: string) {
      const actor = await actorUserId();
      if (!actor) return { status: "access-required" as const };
      try {
        return await messaging.createConversation({
          actorUserId: actor,
          profileId,
          commandId,
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
    async openBookingConversation(
      bookingRequestReference: string,
      commandId: string,
    ) {
      const actor = await actorUserId();
      if (!actor) return { status: "access-required" as const };
      try {
        return await messaging.openBookingConversation({
          actorUserId: actor,
          bookingRequestReference,
          commandId,
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
    async createConversationForCottage(publicSlug: string, commandId: string) {
      const actor = await actorUserId();
      if (!actor) return { status: "access-required" as const };
      try {
        return await messaging.createConversationForCottage({
          actorUserId: actor,
          publicSlug,
          commandId,
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
    async send(
      input: Omit<Parameters<MessagingRepository["send"]>[0], "actorUserId">,
    ) {
      const actor = await actorUserId();
      if (!actor) return { status: "access-required" as const };
      try {
        return await messaging.send({ ...input, actorUserId: actor });
      } catch {
        return { status: "unavailable" as const };
      }
    },
  };
}
