/** Placeholder equipment photo for the browser-only demo: a calm colour block per image id. */
const COLORS = ['#1f5f99', '#d9a03a', '#4f8a5b', '#a8473b', '#6b7a8f', '#7a5c99'];

export function demoImageSvg(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = COLORS[h % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="${color}"/><rect x="250" y="210" width="300" height="180" rx="16" fill="#ffffff" opacity="0.18"/></svg>`;
}

export const demoImageUrl = (id: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(demoImageSvg(id))}`;
