/** Blends two hex colors (50/50) for email-safe rank accent tones. */
function blendHex(a: string, b: string): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ] as const;
  };

  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const mix = (x: number, y: number) => Math.round((x + y) / 2);

  const r = mix(r1, r2).toString(16).padStart(2, '0');
  const g = mix(g1, g2).toString(16).padStart(2, '0');
  const bl = mix(b1, b2).toString(16).padStart(2, '0');
  return `#${r}${g}${bl}`;
}

const SUPPORT_RANK_COLORS: Record<string, string> = {
  'Chief Executive Officer': blendHex('#090979', '#00d4ff'),
  'Chief Operation Officer': '#ff0000',
  'Board of Directors': blendHex('#9e6bff', '#9fc1ff'),
  'Executive Officer': blendHex('#e91e63', '#652a8d'),
};

const DEFAULT_RANK_COLOR = '#94a3b8';

export function getSupportRankColor(rank: string): string {
  return SUPPORT_RANK_COLORS[rank] ?? DEFAULT_RANK_COLOR;
}

export function renderSupportSignature(name: string, rank: string): string {
  const rankColor = getSupportRankColor(rank);

  return [
    '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0;">',
    '<p style="margin:0;line-height:1.7;">',
    '<span style="color:#cbd5e1;font-size:14px;">Best Regards,</span><br>',
    `<strong style="color:#f1f5f9;font-size:15px;">${name}</strong><br>`,
    `<span style="color:${rankColor};font-size:14px;font-weight:600;">${rank}</span>`,
    '</p>',
  ].join('');
}
