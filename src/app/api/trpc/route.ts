import { NextResponse } from "next/server";

/**
 * Root tRPC endpoint handler.
 *
 * tRPC procedures are handled at /api/trpc/[procedure], but requests
 * to the base /api/trpc path need to return JSON (not HTML 404) for:
 * 1. Smoke tests that validate routing returns JSON
 * 2. Debugging to confirm requests reach the app
 *
 * This prevents the "HTML instead of JSON" routing error detection
 * when ALB routes are misconfigured.
 */

const response = {
  error: "No procedure specified",
  message: "tRPC requires a procedure name. Use /api/trpc/<procedure> format.",
  hint: "This endpoint confirms requests are reaching the Buylist app correctly.",
};

export async function GET() {
  return NextResponse.json(response, { status: 400 });
}

export async function POST() {
  return NextResponse.json(response, { status: 400 });
}
