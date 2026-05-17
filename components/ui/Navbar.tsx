"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton, useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { ExternalLink, Lock, LogOut, Moon, PlusCircle, Settings, Sun, User } from "lucide-react";
import { clsx } from "clsx";
import { canCreateFormsAddress, shortenAddress } from "@/lib/admin";
import { loadAllSubmissions } from "@/lib/forms";
import type { FormSubmission } from "@/types";

const NAV_LINKS = [
  { href: "/", label: "Home", access: "connected" },
  { href: "/builder", label: "Form Builder", access: "admin" },
  { href: "/dashboard", label: "Dashboard", access: "connected" },
];

type ProfileTab = "profile" | "submissions" | "settings";

type AccountProfile = {
  username: string;
  email: string;
  x: string;
  telegram: string;
  discord: string;
};

const emptyProfile: AccountProfile = {
  username: "",
  email: "",
  x: "",
  telegram: "",
  discord: "",
};

function profileStorageKey(address: string) {
  return `sealedsurvey:profile:${address.toLowerCase()}`;
}

function loadStoredProfile(address: string): AccountProfile {
  try {
    const raw = localStorage.getItem(profileStorageKey(address));
    return raw ? { ...emptyProfile, ...JSON.parse(raw) } : emptyProfile;
  } catch {
    return emptyProfile;
  }
}

function saveStoredProfile(address: string, profile: AccountProfile) {
  localStorage.setItem(profileStorageKey(address), JSON.stringify(profile));
}

function submissionIdentity(submission: FormSubmission) {
  return submission.walrusBlobId || submission.id;
}

export function Navbar() {
  const pathname = usePathname();
  const account = useCurrentAccount();
  const disconnectWallet = useDisconnectWallet();
  const showBuilderNav = account && canCreateFormsAddress(account.address);
  const [darkMode, setDarkMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>("profile");
  const [profile, setProfile] = useState<AccountProfile>(emptyProfile);
  const [profileSaved, setProfileSaved] = useState(false);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("sealedsurvey:theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const enabled = stored ? stored === "dark" : prefersDark;
    setDarkMode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);

  useEffect(() => {
    if (!account) {
      setMenuOpen(false);
      setProfile(emptyProfile);
      setSubmissions([]);
      return;
    }

    setProfile(loadStoredProfile(account.address));
    loadAllSubmissions()
      .then((items) => {
        const address = account.address.toLowerCase();
        setSubmissions(items.filter((submission) => submission.submitterAddress?.toLowerCase() === address));
      })
      .catch(() => setSubmissions([]));
  }, [account?.address]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("sealedsurvey:theme", next ? "dark" : "light");
  };

  const saveProfile = () => {
    if (!account) return;
    saveStoredProfile(account.address, profile);
    setProfileSaved(true);
    window.setTimeout(() => setProfileSaved(false), 1400);
  };

  const disconnect = async () => {
    await disconnectWallet.mutateAsync();
    setMenuOpen(false);
  };

  const groupedSubmissions = Object.values(
    submissions.reduce<Record<string, { id: string; title: string; latestAt: string; submissions: FormSubmission[] }>>(
      (acc, submission) => {
        const key = submission.formId || submission.formTitle || "untitled-form";
        const existing = acc[key] ?? {
          id: key,
          title: submission.formTitle || "Untitled form",
          latestAt: submission.submittedAt,
          submissions: [],
        };
        existing.latestAt =
          new Date(submission.submittedAt).getTime() > new Date(existing.latestAt).getTime()
            ? submission.submittedAt
            : existing.latestAt;
        existing.submissions.push(submission);
        acc[key] = existing;
        return acc;
      },
      {}
    )
  )
    .map((group) => ({
      ...group,
      submissions: group.submissions.sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      ),
    }))
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());

  const avatarLabel = (profile.username || account?.address || "U").slice(0, 2).toUpperCase();

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
          {account ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-teal-100 bg-teal-500 text-xs font-semibold text-white shadow-sm ring-2 ring-teal-50 transition hover:border-teal-300 dark:border-violet-400/60 dark:bg-violet-500 dark:ring-gray-900"
                aria-label="Open profile menu"
              >
                {avatarLabel}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-teal-100 bg-white shadow-xl dark:border-violet-400/60 dark:bg-gray-950">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-violet-400/40 dark:bg-gray-900">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500 text-xs font-semibold text-white dark:bg-violet-500">
                        {avatarLabel}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                          {profile.username || "Unnamed profile"}
                        </div>
                        <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-300">
                          {shortenAddress(account.address)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1 border-b border-slate-100 p-2 dark:border-violet-400/40">
                    {[
                      { id: "profile" as const, label: "Profile", icon: User },
                      { id: "submissions" as const, label: "My Submission", icon: ExternalLink },
                      { id: "settings" as const, label: "Setting", icon: Settings },
                    ].map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setActiveTab(item.id)}
                          className={clsx(
                            "flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition",
                            activeTab === item.id
                              ? "bg-teal-500 text-white dark:bg-violet-500"
                              : "text-slate-500 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gray-900"
                          )}
                        >
                          <Icon size={12} />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="max-h-[26rem] overflow-y-auto p-4">
                    {activeTab === "profile" && (
                      <div className="space-y-3">
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-300">
                          Username
                          <input
                            value={profile.username}
                            onChange={(event) => setProfile((current) => ({ ...current, username: event.target.value }))}
                            placeholder="Add username"
                            className="input mt-1 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-300">
                          Email
                          <input
                            value={profile.email}
                            onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))}
                            placeholder="Add email"
                            className="input mt-1 text-sm"
                          />
                        </label>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-violet-400/50 dark:bg-gray-900">
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-300">Connected address</div>
                          <div className="mt-1 break-all font-mono text-xs text-slate-800 dark:text-white">{account.address}</div>
                        </div>
                        <button type="button" onClick={saveProfile} className="btn btn-primary w-full text-xs">
                          {profileSaved ? "Updated" : "Update profile"}
                        </button>
                      </div>
                    )}

                    {activeTab === "submissions" && (
                      <div className="space-y-3">
                        {groupedSubmissions.length === 0 && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500 dark:border-violet-400/50 dark:bg-gray-900 dark:text-slate-300">
                            No submissions found for this wallet.
                          </div>
                        )}
                        {groupedSubmissions.map((group) => (
                          <div key={group.id} className="overflow-hidden rounded-lg border border-slate-200 dark:border-violet-400/50">
                            <div className="bg-slate-50 px-3 py-2 dark:bg-gray-900">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">{group.title}</div>
                              <div className="text-xs text-slate-400">
                                {group.submissions.length} submission{group.submissions.length === 1 ? "" : "s"}
                              </div>
                            </div>
                            <div className="divide-y divide-slate-100 dark:divide-violet-400/30">
                              {group.submissions.map((submission, index) => (
                                <div key={submissionIdentity(submission)} className="flex items-center justify-between gap-3 px-3 py-2">
                                  <div>
                                    <div className="text-xs font-medium text-slate-700 dark:text-white">
                                      Submission #{group.submissions.length - index}
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      {new Date(submission.submittedAt).toLocaleDateString("id-ID", {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                      })}
                                    </div>
                                  </div>
                                  <Link
                                    href={`/receipt/${encodeURIComponent(submission.walrusBlobId)}`}
                                    onClick={() => setMenuOpen(false)}
                                    className="btn btn-secondary px-2.5 py-1 text-xs"
                                  >
                                    Detail
                                  </Link>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === "settings" && (
                      <div className="space-y-3">
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-300">
                          X
                          <input
                            value={profile.x}
                            onChange={(event) => setProfile((current) => ({ ...current, x: event.target.value }))}
                            placeholder="@username or profile URL"
                            className="input mt-1 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-300">
                          Telegram
                          <input
                            value={profile.telegram}
                            onChange={(event) => setProfile((current) => ({ ...current, telegram: event.target.value }))}
                            placeholder="@username"
                            className="input mt-1 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-300">
                          Discord
                          <input
                            value={profile.discord}
                            onChange={(event) => setProfile((current) => ({ ...current, discord: event.target.value }))}
                            placeholder="username"
                            className="input mt-1 text-sm"
                          />
                        </label>
                        <button type="button" onClick={saveProfile} className="btn btn-primary w-full text-xs">
                          {profileSaved ? "Saved" : "Save settings"}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 p-2 dark:border-violet-400/40">
                    <button
                      type="button"
                      onClick={disconnect}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      <LogOut size={14} />
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <ConnectButton connectText="Connect" />
          )}
        </div>
      </div>
    </nav>
  );
}
