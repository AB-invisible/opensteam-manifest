import { describe, expect, it } from 'vitest';
import {
  appendAntiPhishingToDiscordPayload,
  generateAntiPhishingCode,
  injectAntiPhishingIntoHtml,
  renderAntiPhishingEmailBlock,
  renderAntiPhishingPlainText,
} from '@/app/lib/anti-phishing';

describe('generateAntiPhishingCode', () => {
  it('generates a GG-prefixed code with three segments', () => {
    const code = generateAntiPhishingCode();
    expect(code).toMatch(/^GG-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  });
});

describe('injectAntiPhishingIntoHtml', () => {
  it('injects before the support hint marker', () => {
    const html = '<div>body</div><!-- Support hint --><footer></footer>';
    const code = 'GG-ABCD-1234-5678';
    const result = injectAntiPhishingIntoHtml(html, code);
    expect(result).toContain(renderAntiPhishingEmailBlock(code).trim());
    expect(result.indexOf('Anti-Phishing Code:')).toBeLessThan(result.indexOf('<!-- Support hint -->'));
  });

  it('does not double-inject when already present', () => {
    const html = '<div>Anti-Phishing Code: GG-TEST</div>';
    const result = injectAntiPhishingIntoHtml(html, 'GG-ABCD-1234-5678');
    expect(result).toBe(html);
  });
});

describe('renderAntiPhishingPlainText', () => {
  it('includes the code in plain text', () => {
    expect(renderAntiPhishingPlainText('GG-ABCD-1234-5678')).toContain('GG-ABCD-1234-5678');
  });
});

describe('appendAntiPhishingToDiscordPayload', () => {
  it('adds an embed field when embeds are present', () => {
    const result = appendAntiPhishingToDiscordPayload(
      { embeds: [{ title: 'Notice', description: 'Hello' }] },
      'GG-ABCD-1234-5678'
    );

    const fields = (result.embeds?.[0] as { fields?: Array<{ name: string; value: string }> }).fields;
    expect(fields?.some((field) => field.name.includes('Anti-Phishing'))).toBe(true);
    expect(fields?.[0]?.value).toContain('GG-ABCD-1234-5678');
  });

  it('appends content when no embed is present', () => {
    const result = appendAntiPhishingToDiscordPayload({ content: 'Hello' }, 'GG-ABCD-1234-5678');
    expect(result.content).toContain('GG-ABCD-1234-5678');
  });
});
