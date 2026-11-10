import { sessionUser } from "@/lib/server/auth";
import { avatarsOwnedBy } from "@/lib/server/db";
import { handle, summaryView } from "@/lib/server/http";

/** The signed-in account and its avatars, or `user: null` for a visitor. */
export const GET = handle(async (req: Request) => {
  const user = sessionUser(req);
  if (!user) return Response.json({ user: null, avatars: [] });
  return Response.json({ user: { email: user.email }, avatars: avatarsOwnedBy(user.id)
      // A draft with no selfie yet is just an opened creator, not something to list.
      .filter((r) => r.selfie)
      .map(summaryView) });
});
