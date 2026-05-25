import type { Metadata } from "next";
import Script from "next/script";
import { AppMessageProvider } from "./app-message";
import "./(auth)/auth.css";
import "react-datepicker/dist/react-datepicker.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadHunt AI",
  description: "AI outbound workflow for B2B exporters"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {process.env.NODE_ENV === "development" ? (
          <Script id="remove-extension-dom-before-hydration" strategy="beforeInteractive">
            {`document.getElementById("uptook-plugin-linkedin")?.remove();`}
          </Script>
        ) : null}
        <AppMessageProvider>{children}</AppMessageProvider>
      </body>
    </html>
  );
}
