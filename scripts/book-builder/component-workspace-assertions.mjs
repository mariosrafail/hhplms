import { expect } from "@playwright/test";

export async function openComponentWorkspace(page, origin, shell, component) {
  const card = page.locator(".hosted-builder-component-card").filter({ has: page.getByRole("heading", { name: component.componentTitle, exact: true }) });
  const link = card.getByRole("link", { name: "Open workspace", exact: true });
  if (component.componentSlug === `${shell.bookSlug}-grammar-book`) {
    await expect(link).toHaveCount(0);
    await expect(card.locator(".hosted-builder-unavailable")).toHaveCount(0);
    await page.goto(`${origin}/#/books/${shell.bookSlug}/components/${component.componentSlug}`);
  } else await link.click();
}
