import { sessionUser } from "@/lib/server/auth";
import { createAvatar } from "@/lib/server/db";
import { handle, ownerView, rateLimit } from "@/lib/server/http";

/**
 * Starts a new draft avatar. The edit token is only ever returned here. A
 * signed-in creator's draft belongs to their account from the start.
 */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "create", 10);
  const { record, editToken } = await createAvatar((await sessionUser(req))?.id);
  return Response.json({ avatar: await ownerView(record), editToken });
});
