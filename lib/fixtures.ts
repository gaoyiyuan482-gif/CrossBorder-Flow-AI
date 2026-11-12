import type { ScenarioId } from "./domain";

export const paymentFixture = {
  id: "PAY-2026-0482",
  payer: "Meridian Trading Pte Ltd",
  payerCountry: "Singapore",
  beneficiary: "Peninsula Components Sdn Bhd",
  beneficiaryCountry: "Malaysia",
  amount: 48_000,
  currency: "MYR",
  invoice: "INV-MY-2048.pdf",
  supplierId: "SUP-MY-018",
  purchaseOrder: "PO-MY-8820",
} as const;

export const invoiceText = [
  "Invoice: INV-MY-2048",
  "Supplier: Peninsula Components Sdn Bhd",
  "Amount: 48,000",
  "Currency: MYR",
  "Beneficiary Account: 8821",
  "Issued: 10 Nov 2026",
  "Synthetic Fixture: true",
].join("\n");

export function erpFixture(scenario: ScenarioId) {
  return {
    synthetic: true,
    supplier_id: paymentFixture.supplierId,
    purchase_order: paymentFixture.purchaseOrder,
    supplier: paymentFixture.beneficiary,
    amount: paymentFixture.amount,
    currency: paymentFixture.currency,
    beneficiary_account: scenario === "normal" ? "8821" : "8812",
    source: "MOCK_ERP_API",
  };
}

export const delayedBankEvent = {
  event_id: "EVT-5821",
  payment_id: paymentFixture.id,
  event_type: "PAYMENT_DELAYED",
  reason: "BANK_REVIEW_PENDING",
  source: "MOCK_BANK_API",
  synthetic: true,
} as const;

export const completedBankEvent = {
  event_id: "EVT-5822",
  payment_id: paymentFixture.id,
  event_type: "PAYMENT_COMPLETED",
  source: "MOCK_BANK_API",
  synthetic: true,
} as const;
