import { endSession } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

export const POST = handle(async (req: Request) => Response.json({ ok: true }, { headers: { "set-cookie": await endSession(req) } }));
