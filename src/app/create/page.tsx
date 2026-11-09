import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateFlow } from "@/components/create/CreateFlow";

export const metadata: Metadata = {
  title: "Create your avatar",
  robots: { index: false },
};

export default function CreatePage() {
  return (
    <Suspense>
      <CreateFlow />
    </Suspense>
  );
}
