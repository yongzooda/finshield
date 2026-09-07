import { sessionGrant } from "@/lib/finshield/session-grant";
import { signOutSession } from "@/lib/finshield/signout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const DELETE = signOutSession;
export const POST = (request: Request) => sessionGrant(request, "login");
export const PATCH = (request: Request) => sessionGrant(request, "refresh");
