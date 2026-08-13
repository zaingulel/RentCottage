import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "RentCottage",
  description: "A trilingual marketplace for rural stays across Iraq.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
