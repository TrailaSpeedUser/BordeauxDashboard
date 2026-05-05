"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={path.startsWith(href) ? "active" : ""}
    >
      {label}
    </Link>
  );

  return (
    <nav>
      {link("/trips", "Trips")}
      {isAdmin && link("/upload", "Upload")}
    </nav>
  );
}
