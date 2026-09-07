import { sessionGrant } from "@/lib/finshield/session-grant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => sessionGrant(request, "signup");
