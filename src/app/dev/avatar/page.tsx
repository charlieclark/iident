import { notFound } from "next/navigation";
import { AvatarHarness } from "@/components/dev/AvatarHarness";

/** Developer harness for the avatar runtime (development builds only). */
export default function DevAvatarPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <AvatarHarness />;
}
