import "./globals.css";
import type { Metadata } from "next";
import PwaRegister from "./pwa-register";

export const metadata: Metadata = {
  title: "Krypto Dashboard",
  description: "Krypto Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#020617" />

        {/* Android/Chrome */}
        <meta name="mobile-web-app-capable" content="yes" />

        {/* iOS */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Krypto" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
      </head>
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
