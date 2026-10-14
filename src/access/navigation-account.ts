import type { NavigationAccount } from "@/components/site-header";
import type { RequestAccount } from "./request-account-context";
import type { RequestAccountName } from "./request-account-name";

export function navigationAccountFor(
  account: RequestAccount,
  name: RequestAccountName | undefined,
): NavigationAccount {
  if (account.status !== "authenticated") return account;
  return {
    status: account.status,
    context: account.context
      ? {
          role: account.context.role,
          ...(account.context.role === "cottage_owner"
            ? { approvalState: account.context.approvalState }
            : {}),
        }
      : undefined,
    ...(name?.status === "named"
      ? { name: { status: "named" as const, initial: name.initial } }
      : name?.status === "missing"
        ? { name: { status: "missing" as const } }
        : {}),
  };
}
