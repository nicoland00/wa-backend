import type { Metadata } from "next";
import SessionProvider from "@/components/SessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pastora · Administración",
  description: "Panel de administración: animales, pesajes, vídeos y sincronización.",
  icons: { icon: { url: "/pastora-favicon.ico?v=2", type: "image/x-icon" }, shortcut: "/pastora-favicon.ico?v=2" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
