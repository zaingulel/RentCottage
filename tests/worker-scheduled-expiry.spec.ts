import { expect, test } from "@playwright/test";

test("the test Worker expires due booking requests exactly once", async ({
  request,
}) => {
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const response = await request.get(
      "/__scheduled?format=json&cron=%2A%20%2A%20%2A%20%2A%20%2A",
    );
    expect(response.ok()).toBe(true);
  }
});
