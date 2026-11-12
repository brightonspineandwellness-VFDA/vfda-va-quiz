import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { themeCss } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VFDA VA Quiz App",
  description: "Daily training quizzes for VFDA office VAs",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <head>
        {/* The theme's colors and sizes (src/lib/theme.ts). */}
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
