import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime";

import { SupabaseCustomerReviewRepository } from "./supabase-customer-review";

export async function createRequestCustomerReview() {
  if (!bookingRequestTestRuntimeIsEnabled()) {
    return undefined;
  }

  const client = await createRequestSupabaseClient();
  const repository = new SupabaseCustomerReviewRepository(client);
  return {
    authenticatedUserId: async () => {
      const { data, error } = await client.auth.getUser();
      return error === null && data.user?.id ? data.user.id : undefined;
    },
    submit: repository.submit.bind(repository),
    getOwn: repository.getOwn.bind(repository),
    listPublic: repository.listPublic.bind(repository),
    listAdministrator: repository.listAdministrator.bind(repository),
    hide: repository.hide.bind(repository),
  };
}
