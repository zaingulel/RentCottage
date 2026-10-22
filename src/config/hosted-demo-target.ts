interface HostedDemoTarget {
  readonly workerOrigin: string;
  readonly supabaseProjectRef: string;
  readonly accessIssuer: string;
  readonly accessAudience: string;
}

// Populate only after exact-target approval and the corresponding resource receipt.
export const hostedDemoTarget: HostedDemoTarget | null = null;
