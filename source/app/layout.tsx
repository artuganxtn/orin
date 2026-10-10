import type { Metadata } from "next";
import "./globals.css";
import "./reference.css";
import "./quality.css";
import "./settings-system.css";
import "./orin-identity.css";
import "./reference-release.css";
import "./settings-refresh.css";

export const metadata: Metadata = {
  title: "أورين | ORIN",
  manifest: "/manifest.webmanifest",
  description: "أورين — مساحة العقود الداخلية، المحفظة وبيانات السوق. حساب تجريبي بأرصدة افتراضية.",
  icons: {
    icon: "/brand/web/icon-32.png",
    shortcut: "/brand/web/icon-32.png",
    apple: "/brand/ios/icon-180.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
