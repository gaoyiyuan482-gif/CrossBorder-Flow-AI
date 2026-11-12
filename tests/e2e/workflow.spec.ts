import { expect, test, type Page } from "@playwright/test";

async function loadScenario(page: Page, scenario: string) {
  await page.getByTestId("nav-demo").click();
  await page.getByTestId(`scenario-${scenario}`).click();
  await expect(page.getByTestId("toast")).toContainText("已重置并加载");
}

async function prepareMismatch(page: Page, evidence = "CALL-E2E-0482") {
  await page.getByTestId("role-maker").click();
  await loadScenario(page, "mismatch");
  await page.getByTestId("nav-documents").click();
  await page.getByTestId("parse-documents").click();
  await expect(page.getByText("8812", { exact: true }).first()).toBeVisible();
  await page.getByTestId("nav-verification").click();
  await page.getByTestId("verification-method").fill("供应商已登记电话回拨");
  await page.getByTestId("verification-evidence").fill(evidence);
  await page.getByTestId("verification-account").fill("8812");
  await page.getByTestId("record-verification").click();
  await page.getByTestId("submit-approval").click();
}

test("E2E：完整主线、正常分支、拒绝分支、持久化与 API 防绕过", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("付款总览", { exact: true }).first()).toBeVisible();

  // 账户不一致主线，并验证刷新后 D1 状态恢复。
  await prepareMismatch(page);
  await page.reload();
  await page.getByTestId("nav-verification").click();
  await expect(page.getByText("CALL-E2E-0482")).toBeVisible();
  await page.getByTestId("role-approver").click();
  await page.getByTestId("nav-approval").click();
  await page.getByTestId("approve-payment").click();
  await expect(page.getByTestId("toast")).toContainText("仍未提交银行");
  await page.getByTestId("nav-tracking").click();
  await page.getByTestId("submit-bank").click();
  await page.getByTestId("bank-delayed").click();
  await expect(page.getByText("银行审核延迟")).toBeVisible();
  await page.getByTestId("nav-exception").click();
  await page.getByTestId("investigate-exception").click();
  await expect(page.getByText("deterministic-mock-v1")).toBeVisible();
  await page.getByTestId("followup-action").fill("已用登记电话联系供应商");
  await page.getByTestId("followup-evidence").fill("FOLLOWUP-E2E-0482");
  await page.getByTestId("confirm-followup").click();
  await expect(page.getByTestId("toast")).toContainText("仍为 Delayed");
  await page.getByTestId("nav-tracking").click();
  await page.getByTestId("bank-completed").click();
  await expect(page.getByText("模拟银行确认完成")).toBeVisible();

  // 正常匹配也必须由 Ajith 审批。
  await page.getByTestId("role-maker").click();
  await loadScenario(page, "normal");
  await page.getByTestId("nav-documents").click();
  await page.getByTestId("parse-documents").click();
  await expect(page.getByText("所有关键字段核对一致")).toBeVisible();
  await page.getByTestId("role-approver").click();
  await page.getByTestId("nav-approval").click();
  await page.getByTestId("approve-payment").click();
  await page.getByTestId("nav-tracking").click();
  await page.getByTestId("submit-bank").click();
  await page.getByTestId("bank-completed").click();
  await expect(page.getByText("模拟银行确认完成")).toBeVisible();

  // 拒绝后银行提交保持禁用。
  await prepareMismatch(page, "CALL-E2E-REJECT");
  await page.getByTestId("role-approver").click();
  await page.getByTestId("nav-approval").click();
  await page.getByTestId("reject-payment").click();
  await page.getByTestId("nav-tracking").click();
  await expect(page.getByTestId("submit-bank")).toBeDisabled();

  // 直接调用 API 仍不能绕过人工核实。
  const session = `api-bypass-${Date.now()}`;
  const headers = { "x-demo-session": session };
  await page.request.post("/api/workflow", { headers, data: { action: "RESET_SCENARIO", scenario: "mismatch", actor: { id: "demo-admin", role: "DEMO_ADMIN" } } });
  await page.request.post("/api/workflow", { headers, data: { action: "PARSE_DOCUMENTS", actor: { id: "samuel-maker", role: "MAKER" } } });
  const response = await page.request.post("/api/workflow", { headers, data: { action: "APPROVE", actor: { id: "ajith-approver", role: "APPROVER" } } });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain("只有待审批付款");
});
