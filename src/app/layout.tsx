import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "عيادة سكينة — نظام إدارة العيادات النفسية",
  description:
    "نظام إدارة عيادات نفسية متكامل: الاستقبال، الطابور، المدفوعات، السجلات الطبية، والتواصل الفوري.",
  icons: { icon: "/favicon-clinic.svg" },
};

export const viewport: Viewport = {
  themeColor: "#141a26",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased">
        <span data-live-marker="9431" hidden />
        {children}
      </body>
    </html>
  );
}
