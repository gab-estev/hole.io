import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "VOID Arena — Eat everything", description: "Two players. Three worlds. One very hungry hole.", icons: {icon: "/assets/favicon.svg"} };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
