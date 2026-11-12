import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CrossBorder Flow AI",
  description: "Synthetic enterprise payment workflow integration demo for Singapore and Southeast Asia.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
