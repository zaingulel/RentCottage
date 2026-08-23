alter type public.cottage_inventory_commitment_status
  add value if not exists 'released_hold';
