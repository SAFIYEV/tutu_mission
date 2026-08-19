import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-product",
  subsets: ["cyrillic", "latin"],
});

export const metadata: Metadata = {
  title: "tutu mission — поставьте задачу, получите маршрут",
  description: "tutu mission понимает задачу поездки, находит актуальные варианты и программно подтверждает выполнимость маршрута.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
