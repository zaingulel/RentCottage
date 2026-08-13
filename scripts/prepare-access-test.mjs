import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  process.exitCode = 2;
} else {
  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const password = "Local-test-password-2026";
  const { data: users, error: listError } = await client.auth.admin.listUsers();
  if (listError) throw listError;
  for (const profile of ["mobile", "desktop", "worker"]) {
    const email = `platform-administrator-${profile}@rentcottage.test`;
    const existing = users.users.find((user) => user.email === email);
    if (existing) {
      const { error } = await client.auth.admin.deleteUser(existing.id);
      if (error) throw error;
    }
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const { error: provisionError } = await client.rpc(
      "provision_platform_administrator",
      { target_user_id: data.user.id },
    );
    if (provisionError) throw provisionError;
  }
}
