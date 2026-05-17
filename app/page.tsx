import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  Database,
  FileText,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { WalrusStatusBadge } from "@/components/ui/WalrusStatusBadge";

const STEPS = [
  "Build forms from templates",
  "Encrypt sensitive answers with Seal",
  "Store schema, responses, and media on Walrus",
  "Review respondents from the owner dashboard",
];

const USE_CASES = [
  { title: "Bug reports", value: "Private issue intake" },
  { title: "Feature requests", value: "Prioritized product feedback" },
  { title: "Surveys", value: "Encrypted community responses" },
  { title: "Applications", value: "Deadline-gated submissions" },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
      <section className="relative overflow-hidden rounded-lg border border-teal-100 bg-white/85 shadow-[0_28px_90px_rgba(15,118,110,0.12)] ring-1 ring-teal-900/[0.04] backdrop-blur dark:border-violet-400/25 dark:bg-slate-900/80 dark:shadow-[0_28px_90px_rgba(124,58,237,0.16)]">
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-yellow-300 to-transparent dark:via-violet-400" />
        <div className="grid gap-8 px-5 py-8 lg:grid-cols-[1.02fr_0.98fr] lg:px-8 lg:py-10">
          <div className="flex flex-col justify-center">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <WalrusStatusBadge />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-200 bg-yellow-100 px-2.5 py-1 text-xs font-medium text-black dark:border-violet-400/40 dark:bg-slate-950 dark:text-white">
                <Sparkles size={12} />
                Hackathon-ready private forms
              </span>
            </div>

            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] tracking-tight text-black sm:text-6xl dark:text-white">
              Private forms for builders, stored on{" "}
              <span className="text-teal-600 dark:text-violet-300">Walrus</span>.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg dark:text-slate-300">
              SealedSurvey helps owners publish encrypted bug reports, feature requests,
              surveys, and applications with deadlines, media uploads, and respondent
              review in one dashboard.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/builder" className="btn btn-primary">
                <ArrowRight size={15} />
                Create encrypted form
              </Link>
              <Link href="/dashboard" className="btn btn-secondary">
                <BarChart3 size={15} />
                Open dashboard
              </Link>
            </div>

            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {STEPS.map((step) => (
                <div key={step} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-violet-500/20 dark:text-violet-200">
                    <Check size={12} />
                  </span>
                  {step}
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="rounded-lg border border-teal-100 bg-cyan-50/80 p-3 shadow-inner dark:border-violet-400/25 dark:bg-slate-950/60">
              <div className="rounded-lg border border-white bg-white p-4 shadow-[0_22px_60px_rgba(15,118,110,0.14)] dark:border-violet-400/20 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-black dark:text-white">Grant application</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Closes 17 May 2026, 23:00</div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-teal-100 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-200">
                    <Lock size={10} />
                    Seal
                  </span>
                </div>

                <div className="space-y-3">
                  {["username", "email", "Project summary"].map((label, index) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
                      <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                        {label} <span className="text-yellow-500">*</span>
                      </div>
                      <div className={`rounded-md bg-slate-100 dark:bg-slate-800 ${index === 2 ? "h-16" : "h-8"}`} />
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {["Draft", "Preview", "Publish"].map((item) => (
                    <div
                      key={item}
                      className="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-center text-xs font-medium text-black dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-white"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-100 p-4 dark:border-violet-400/30 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold text-black dark:text-white">Owner dashboard</div>
                  <Database size={15} className="text-teal-700 dark:text-violet-300" />
                </div>
                <div className="space-y-2">
                  {["Bug report", "Feature request", "Creator application"].map((row, index) => (
                    <div key={row} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md bg-white px-3 py-2 text-xs dark:bg-slate-950">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{row}</span>
                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-teal-700 dark:bg-violet-500/20 dark:text-violet-200">
                        {index + 4} responses
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-4">
        {USE_CASES.map((item) => (
          <div key={item.title} className="card">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-violet-500/20 dark:text-violet-200">
              <FileText size={16} />
            </div>
            <div className="text-sm font-semibold text-black dark:text-white">{item.title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-black dark:text-white">
            <ShieldCheck size={17} className="text-teal-600 dark:text-violet-300" />
            Why SealedSurvey
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Seal-first", "Sensitive answers decrypt only for the form owner."],
              ["Walrus-backed", "Forms, submissions, and media are stored as verifiable blobs."],
              ["Operational", "Review respondent details, deadlines, priorities, and exports."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-lg border border-teal-100 bg-cyan-50/80 p-3 dark:border-violet-400/20 dark:bg-slate-950/70">
                <div className="text-sm font-medium text-black dark:text-white">{title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{body}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card border-yellow-200 bg-yellow-100/80 dark:border-violet-400/25 dark:bg-slate-900/80">
          <div className="text-sm font-semibold text-black dark:text-white">Current build</div>
          <div className="mt-3 space-y-2 text-xs text-slate-700 dark:text-slate-300">
            <div>Media limits: 15 MiB images, 100 MiB videos</div>
            <div>Forms can open and close by owner schedule</div>
            <div>Dashboard decrypts owner responses with cached Seal sessions</div>
          </div>
        </div>
      </section>
    </div>
  );
}
