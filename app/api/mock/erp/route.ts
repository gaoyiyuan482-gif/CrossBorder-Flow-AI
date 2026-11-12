import { NextResponse } from "next/server";
import { erpFixture } from "../../../../lib/fixtures";

export async function GET(request: Request) {
  const scenario = new URL(request.url).searchParams.get("scenario") === "normal" ? "normal" : "mismatch";
  return NextResponse.json(erpFixture(scenario));
}
