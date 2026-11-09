import type { Metadata } from "next";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicAvatarView } from "@/components/PublicAvatarView";
import { getAvatarBySlug } from "@/lib/server/db";
import { publicView } from "@/lib/server/http";

// Avatars are looked up per request; a missing slug should be a real 404.
export const instant = false;

const loadAvatar = cache(async (slug: string) => {
  await io();
  const record = getAvatarBySlug(slug);
  return record ? publicView(record) : null;
});

export async function generateMetadata({ params }: PageProps<"/a/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const avatar = await loadAvatar(slug);
  if (!avatar) return { title: "Avatar not found" };
  const name = avatar.persona.name;
  const title = `Talk to ${name}`;
  const description = avatar.persona.tagline || `Say hi to ${name}'s talking 3D AI avatar.`;
  const images = avatar.thumbnailUrl ? [{ url: avatar.thumbnailUrl, width: 600, height: 800, alt: `${name}'s 3D avatar` }] : [];
  return {
    title,
    description,
    openGraph: { title, description, type: "profile", images },
    twitter: { card: "summary_large_image", title, description, images: images.map((i) => i.url) },
  };
}

export default async function AvatarPage({ params }: PageProps<"/a/[slug]">) {
  const { slug } = await params;
  const avatar = await loadAvatar(slug);
  if (!avatar) notFound();
  return <PublicAvatarView avatar={avatar} />;
}
