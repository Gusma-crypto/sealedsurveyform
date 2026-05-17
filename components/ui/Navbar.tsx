"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { Lock, PlusCircle } from "lucide-react";
import { clsx } from "clsx";
import { canCreateFormsAddress } from "@/lib/admin";

const NAV_LINKS = [
  { href: "/", label: "Home", access: "public" },
  { href: "/builder", label: "Form Builder", access: "admin" },
  { href: "/dashboard", label: "Dashboard", access: "connected" },
];

export function Navbar() {
  const pathname = usePathname();
  const account = useCurrentAccount();
  const showBuilderNav = account && canCreateFormsAddress(account.address);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/70 bg-white/75 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-950 shrink-0">
          <div className="w-7 h-7 bg-slate-950 rounded-lg flex items-center justify-center shadow-sm">
            <Lock size={13} className="text-white" />
          </div>
          SealedSurvey
        </Link>

        {/* Nav links */}
        <div className="hidden sm:flex gap-1 rounded-lg border border-slate-200 bg-white/70 p-1 shadow-sm">
          {NAV_LINKS.filter((link) => {
            if (link.access === "public") return true;
            if (link.access === "connected") return Boolean(account);
            return Boolean(showBuilderNav);
          }).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname === link.href
                  ? "bg-slate-950 text-white font-medium shadow-sm"
                  : "text-slate-500 hover:text-slate-950 hover:bg-slate-50"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <span className="hidden md:flex items-center gap-1.5 text-xs text-sky-700 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-100">
            <Lock size={10} />
            Seal encrypted
          </span>
          {showBuilderNav && (
            <Link href="/builder" className="btn btn-primary text-xs py-1.5 px-3">
              <PlusCircle size={13} />
              New form
            </Link>
          )}
          <ConnectButton connectText="Connect" />
        </div>
      </div>
    </nav>
  );
}
