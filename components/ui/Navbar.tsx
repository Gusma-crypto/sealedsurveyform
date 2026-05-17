"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { Lock, Moon, PlusCircle, Sun } from "lucide-react";
import { clsx } from "clsx";
import { canCreateFormsAddress } from "@/lib/admin";

const NAV_LINKS = [
  { href: "/", label: "Home", access: "connected" },
  { href: "/builder", label: "Form Builder", access: "admin" },
  { href: "/dashboard", label: "Dashboard", access: "connected" },
];

export function Navbar() {
  const pathname = usePathname();
  const account = useCurrentAccount();
  const showBuilderNav = account && canCreateFormsAddress(account.address);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sealedsurvey:theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const enabled = stored ? stored === "dark" : prefersDark;
    setDarkMode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("sealedsurvey:theme", next ? "dark" : "light");
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-teal-200 bg-white shadow-sm dark:border-violet-400/60 dark:bg-black">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-white shadow-sm ring-2 ring-teal-100 dark:bg-gray-900 dark:text-white dark:ring-violet-400">
            <Lock size={16} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-black dark:text-white">SealedSurvey</div>
            <div className="text-[11px] font-medium text-teal-700 dark:text-violet-300">Encrypted Walrus Forms</div>
          </div>
        </Link>

        <div className="hidden gap-1 rounded-lg border border-teal-100 bg-white p-1 shadow-sm dark:border-violet-400/60 dark:bg-gray-900 sm:flex">
          {NAV_LINKS.filter((link) => {
            if (link.access === "connected") return Boolean(account);
            return Boolean(showBuilderNav);
          }).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname === link.href
                  ? "bg-teal-500 font-medium text-white shadow-sm dark:bg-violet-500 dark:text-white"
                  : "text-teal-700 hover:bg-teal-50 hover:text-teal-900 dark:text-white dark:hover:bg-gray-800 dark:hover:text-white"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs text-teal-700 dark:border-violet-400/60 dark:bg-gray-900 dark:text-white md:flex">
            <Lock size={10} />
            Seal encrypted
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-teal-100 bg-white text-slate-700 shadow-sm transition-colors hover:border-teal-300 hover:text-black dark:border-violet-400/60 dark:bg-gray-900 dark:text-white dark:hover:border-violet-300"
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          {showBuilderNav && (
            <Link href="/builder" className="btn btn-primary px-3 py-1.5 text-xs">
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
