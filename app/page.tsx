import Link from "next/link";
import { Lock, Database, Share2, BarChart3, ArrowRight, Bug, Lightbulb, Users } from "lucide-react";
import { WalrusStatusBadge } from "@/components/ui/WalrusStatusBadge";

const FEATURES = [
  {
    icon: Lock,
    title: "Seal encryption",
    desc: "Submissions encrypted end-to-end using Seal protocol before hitting Walrus.",
  },
  {
    icon: Database,
    title: "Walrus storage",
    desc: "All data stored permanently on Walrus decentralized storage — no central server.",
  },
  {
    icon: Share2,
    title: "Shareable links",
    desc: "Every form gets a public URL you can share anywhere.",
  },
  {
    icon: BarChart3,
    title: "Admin dashboard",
    desc: "Filter, prioritize, review submissions. Export to CSV anytime.",
  },
];

const SAMPLE_FORMS = [
  { icon: Bug, color: "bg-sky-50 text-sky-600", title: "Bug report", count: 47, sealed: true },
  { icon: Lightbulb, color: "bg-emerald-50 text-emerald-600", title: "Feature request", count: 102, sealed: false },
  { icon: Users, color: "bg-amber-50 text-amber-600", title: "Employee survey", count: 99, sealed: true },
];

export default function HomePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
      {/* Hero */}
      <div className="relative mb-14 overflow-hidden rounded-lg border border-white/70 bg-white/80 px-5 py-12 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.04] backdrop-blur sm:px-10 sm:py-16">
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sky-300 to-transparent" />
        <div className="flex justify-center mb-4">
          <WalrusStatusBadge />
        </div>
        <h1 className="mx-auto mb-4 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          Private feedback,&nbsp;on-chain
        </h1>
        <p className="text-base leading-7 text-slate-500 max-w-2xl mx-auto mb-8 sm:text-lg">
          Create encrypted forms, collect anonymous responses, and store everything
          permanently on Walrus decentralized storage.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/builder" className="btn btn-primary">
            <ArrowRight size={15} />
            Create a form
          </Link>
          <Link href="/dashboard" className="btn btn-secondary">
            <BarChart3 size={15} />
            View dashboard
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-14">
        {[
          { label: "Forms created", value: "12" },
          { label: "Responses", value: "248" },
          { label: "Encrypted", value: "91%" },
          { label: "On Walrus", value: "248" },
        ].map((s) => (
          <div key={s.label} className="card text-center">
            <div className="text-2xl font-semibold text-slate-950 mb-1">{s.value}</div>
            <div className="text-xs text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Sample forms */}
      <h2 className="section-label">Recent forms</h2>
      <div className="grid sm:grid-cols-3 gap-4 mb-14">
        {SAMPLE_FORMS.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="card cursor-pointer transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg ${f.color} flex items-center justify-center`}>
                  <Icon size={17} />
                </div>
                {f.sealed ? (
                  <span className="text-xs bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Lock size={9} /> Seal
                  </span>
                ) : (
                  <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full">
                    Public
                  </span>
                )}
              </div>
              <div className="font-medium text-sm text-slate-950 mb-1">{f.title}</div>
              <div className="text-xs text-slate-400">{f.count} responses</div>
            </div>
          );
        })}
      </div>

      {/* Features */}
      <h2 className="section-label">How it works</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="card flex gap-4">
              <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <Icon size={15} className="text-slate-600" />
              </div>
              <div>
                <div className="font-medium text-sm text-slate-950 mb-1">{f.title}</div>
                <div className="text-sm text-slate-500 leading-relaxed">{f.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Walrus footer note */}
      <div className="mt-10 flex items-start gap-3 rounded-lg border border-sky-100 bg-sky-50/80 p-4 shadow-sm">
        <Database size={16} className="text-sky-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-sky-900 mb-0.5">Powered by Walrus Testnet</p>
          <p className="text-xs text-sky-700 leading-relaxed">
            All form schemas and submissions are uploaded as blobs to Walrus decentralized storage.
            Each submission gets a unique blobId you can verify on-chain.
          </p>
        </div>
      </div>
    </div>
  );
}
