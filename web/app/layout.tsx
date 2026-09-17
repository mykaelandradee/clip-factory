import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clip Factory",
  description: "Transforme vídeos longos em shorts com IA.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
