import { describe, expect, it } from 'vitest';
import { getSupportRankColor, renderSupportSignature } from '@/app/lib/support-rank-styles';

describe('getSupportRankColor', () => {
  it('returns rank-specific accent colors', () => {
    expect(getSupportRankColor('Chief Executive Officer')).toBe('#056fbc');
    expect(getSupportRankColor('Chief Operation Officer')).toBe('#ff0000');
    expect(getSupportRankColor('Board of Directors')).toBe('#9f96ff');
    expect(getSupportRankColor('Executive Officer')).toBe('#a72478');
  });

  it('falls back to the default slate tone for unknown ranks', () => {
    expect(getSupportRankColor('Support Staff')).toBe('#94a3b8');
  });
});

describe('renderSupportSignature', () => {
  it('embeds the rank color in the signature HTML', () => {
    const html = renderSupportSignature('Jane Doe', 'Executive Officer');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('color:#a72478');
    expect(html).toContain('Executive Officer');
  });
});
