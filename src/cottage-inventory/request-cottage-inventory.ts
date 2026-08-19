import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";

import { createCottageInventory } from "./cottage-inventory";
import { SupabaseCottageInventoryRepository } from "./supabase-cottage-inventory";

export async function createRequestCottageInventory() {
  const client = await createRequestSupabaseClient();
  return createCottageInventory(new SupabaseCottageInventoryRepository(client));
}
