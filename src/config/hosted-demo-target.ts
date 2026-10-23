interface HostedDemoTarget {
  readonly workerOrigin: string;
  readonly supabaseProjectRef: string;
  readonly accessIssuer: string;
  readonly accessAudience: string;
}

// Populate only after exact-target approval and the corresponding resource receipt.
export const hostedDemoTarget: HostedDemoTarget | null = {
  workerOrigin: "https://demo.halabeekom.com",
  supabaseProjectRef: "yvibcyqtyihpzpmomnzg",
  accessIssuer: "https://fragrant-snow-bffc.cloudflareaccess.com",
  accessAudience:
    "7cfcb76e2ce196644be64a1d8583ea74c6faef901a9f2c58cc6796468fdb8f92",
};
