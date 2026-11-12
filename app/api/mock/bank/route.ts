import { NextResponse } from "next/server";
import { completedBankEvent, delayedBankEvent } from "../../../../lib/fixtures";

const eventMap = {
  PAYMENT_SUBMITTED: { action: "SUBMIT_BANK", eventId: "EVT-5800" },
  PAYMENT_PROCESSING: { action: "BANK_PROCESSING", eventId: "EVT-5801" },
  PAYMENT_DELAYED: { action: "BANK_DELAYED", eventId: delayedBankEvent.event_id },
  PAYMENT_COMPLETED: { action: "BANK_COMPLETED", eventId: completedBankEvent.event_id },
  PAYMENT_FAILED: { action: "BANK_FAILED", eventId: "EVT-5899" },
} as const;

export async function GET() {
  return NextResponse.json({
    synthetic: true,
    payment_id: delayedBankEvent.payment_id,
    supported_events: Object.keys(eventMap),
    delayed_fixture: delayedBankEvent,
    completed_fixture: completedBankEvent,
    note: "仅为模拟银行事件，不连接任何真实银行系统。",
  });
}

export async function POST(request: Request) {
  const body = await request.json() as { eventType?: keyof typeof eventMap; eventId?: string; source?: string };
  const event = body.eventType ? eventMap[body.eventType] : undefined;
  if (!event) return NextResponse.json({ error: "不支持的模拟银行事件。" }, { status: 400 });
  if (body.source && body.source !== "MOCK_BANK_API") return NextResponse.json({ error: "银行事件来源无效。" }, { status: 400 });
  const response = await fetch(new URL("/api/workflow", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-demo-session": request.headers.get("x-demo-session") ?? "public-default",
    },
    body: JSON.stringify({
      action: event.action,
      eventId: body.eventId ?? event.eventId,
      eventSource: "MOCK_BANK_API",
      actor: { id: "mock-bank-adapter", role: "SYSTEM" },
    }),
  });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": "application/json" } });
}
