import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sumplus Cashier",
  description:
    "An AI agent whose spending you can audit without trusting the company that ran it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="row">
            <Link href="/" className="brand" style={{ color: "inherit" }}>
              <b>Sumplus Cashier</b>
              <span>Proof of spend</span>
            </Link>
            <nav className="top-nav">
              <Link href="/">Session</Link>
              <Link href="/receipts">Receipts</Link>
              <Link href="/verify">Verify</Link>
              <Link href="/attestation">Attestation</Link>
            </nav>
          </div>
        </header>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
