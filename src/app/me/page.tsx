import type { Metadata } from "next";
import { YourAvatars } from "@/components/account/YourAvatars";

export const metadata: Metadata = { title: "Your avatars", robots: { index: false } };

export default function MePage() {
  return <YourAvatars />;
}
