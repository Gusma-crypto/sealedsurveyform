import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";
import { Navbar } from "@/components/ui/Navbar";

export const metadata: Metadata = {
  title: "SealedSurvey — Private feedback on Walrus",
  description:
    "Collect encrypted feedback, bug reports, and surveys stored permanently on Walrus decentralized storage.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <Navbar />
          <main className="min-h-screen">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
