import { createAvatar } from "@/lib/server/db";
import { handle, ownerView, rateLimit } from "@/lib/server/http";

/** Starts a new draft avatar. The edit token is only ever returned here. */
export const POST = handle(async (req: Request) => {
  rateLimit(req, "create", 10);
  const { record, editToken } = createAvatar();
  return Response.json({ avatar: ownerView(record), editToken });
});
