"use client";

import Link from "next/link";
import { listDrafts } from "@/lib/client/api";
import { useClientValue } from "@/lib/client/useClientValue";

/** Links back to the most recent draft stored in this browser. */
export function ContinueDraft() {
  const id = useClientValue(() => listDrafts()[0]?.id ?? null, null);
  if (!id) return null;
  return (
    <Link href={`/create?id=${id}`} className="inline-flex h-12 items-center rounded-full px-5 text-sm font-medium text-ink-700 transition hover:bg-ink-100">
      Continue your draft
    </Link>
  );
}
