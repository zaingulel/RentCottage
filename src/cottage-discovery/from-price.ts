import type { PublicCottageInventoryUnit } from "./supabase-cottage-discovery";

export function fromPriceIqd(
  inventory: PublicCottageInventoryUnit[],
): number | null {
  const prices = inventory.flatMap((unit) =>
    unit.kind === "shift" && unit.available && unit.priceIqd !== null
      ? [unit.priceIqd]
      : [],
  );
  return prices.length === 0 ? null : Math.min(...prices);
}
