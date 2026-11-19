import { sessionUser } from "@/lib/server/auth";
import { createAvatar } from "@/lib/server/db";
import { HttpError, handle, ownerView, rateLimit } from "@/lib/server/http";

/**
 * Starts a new draft avatar, which belongs to the signed-in account from the
 * start: an account comes before anything is made. The edit token (used for
 * the draft's private file links) is only ever returned here.
 */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "create", 10);
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, "Create an account to start your avatar.");
  const { record, editToken } = await createAvatar(user.id);
  return Response.json({ avatar: await ownerView(record), editToken });
});
