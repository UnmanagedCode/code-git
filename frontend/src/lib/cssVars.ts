const NAME_RE = /^--[a-z][a-z0-9-]*$/;

/**
 * Sets a custom property to a pixel length on an element. The only `.style` user outside components/ui (guards.test.ts):
 * dynamic geometry goes through here as a finite number, so no style is ever built from content.
 */
export function setCssPx(el: HTMLElement, name: string, px: number): void {
  if (!NAME_RE.test(name)) throw new Error(`setCssPx: bad custom property name ${JSON.stringify(name)}`);
  if (!Number.isFinite(px)) throw new Error(`setCssPx: ${name} must be a finite number, got ${px}`);
  el.style.setProperty(name, `${px}px`);
}
