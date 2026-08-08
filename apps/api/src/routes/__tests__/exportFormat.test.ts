import { describe, it, expect } from 'vitest';
import { toCsv, toHtmlTable } from '../exportFormat.js';

describe('toCsv', () => {
  it('produces a header-only output for empty rows', () => {
    expect(toCsv([], ['name', 'value'])).toBe('name,value\n');
  });

  it('serializes simple rows', () => {
    const result = toCsv([{ name: 'Alpha', value: 100 }, { name: 'Beta', value: 200 }], ['name', 'value']);
    expect(result).toBe('name,value\nAlpha,100\nBeta,200\n');
  });

  it('quotes a field containing a comma', () => {
    const result = toCsv([{ name: 'Alpha, Inc.', value: 1 }], ['name', 'value']);
    expect(result).toBe('name,value\n"Alpha, Inc.",1\n');
  });

  it('quotes and escapes a field containing a double quote', () => {
    const result = toCsv([{ name: 'The "Best" Vendor', value: 1 }], ['name', 'value']);
    expect(result).toBe('name,value\n"The ""Best"" Vendor",1\n');
  });

  it('quotes a field containing a newline', () => {
    const result = toCsv([{ name: 'Line1\nLine2', value: 1 }], ['name', 'value']);
    expect(result).toBe('name,value\n"Line1\nLine2",1\n');
  });
});

describe('toHtmlTable', () => {
  it('produces valid HTML with a header row and title', () => {
    const html = toHtmlTable([{ name: 'Alpha', value: 100 }], ['name', 'value'], 'Test Report');
    expect(html).toContain('<title>Test Report</title>');
    expect(html).toContain('<th>name</th>');
    expect(html).toContain('<th>value</th>');
    expect(html).toContain('<td>Alpha</td>');
    expect(html).toContain('<td>100</td>');
    expect(html).toMatch(/<table[\s\S]*<\/table>/);
  });

  it('shows a "No data" row when rows is empty', () => {
    const html = toHtmlTable([], ['name', 'value'], 'Empty Report');
    expect(html).toContain('No data');
  });

  it('escapes HTML-unsafe characters in cell values', () => {
    const html = toHtmlTable([{ name: '<script>alert(1)</script>', value: 1 }], ['name', 'value'], 'XSS Test');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
