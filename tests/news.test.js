import { describe, it, expect } from 'vitest';
import { NewsCrawler, defaultXmlParser } from '../src/sentiment/news.js';

describe('defaultXmlParser', () => {
  it('parses basic RSS items', () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Bitcoin hits new high</title>
          <link>https://example.com/1</link>
          <pubDate>Thu, 20 Feb 2026 12:00:00 GMT</pubDate>
          <description>BTC surges past 100k</description>
        </item>
        <item>
          <title>ETH update</title>
          <link>https://example.com/2</link>
          <pubDate>Thu, 20 Feb 2026 11:00:00 GMT</pubDate>
          <description>Ethereum upgrade incoming</description>
        </item>
      </channel></rss>
    `;
    const result = defaultXmlParser(xml);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe('Bitcoin hits new high');
    expect(result.items[0].link).toBe('https://example.com/1');
    expect(result.items[1].title).toBe('ETH update');
  });

  it('handles CDATA sections', () => {
    const xml = `
      <rss><channel>
        <item>
          <title><![CDATA[Breaking: Market crash]]></title>
          <description><![CDATA[<p>Markets tumble</p>]]></description>
        </item>
      </channel></rss>
    `;
    const result = defaultXmlParser(xml);
    expect(result.items[0].title).toBe('Breaking: Market crash');
  });

  it('returns empty array for no items', () => {
    const result = defaultXmlParser('<rss><channel></channel></rss>');
    expect(result.items).toHaveLength(0);
  });
});

describe('NewsCrawler', () => {
  it('filters recent articles', () => {
    const crawler = new NewsCrawler();
    const now = Date.now();
    const articles = [
      { pubDate: new Date(now - 1000 * 60 * 60), source: 'test' },      // 1 hour ago
      { pubDate: new Date(now - 1000 * 60 * 60 * 48), source: 'test' }, // 48 hours ago
      { pubDate: null, source: 'test' },
    ];
    const recent = crawler.filterRecent(articles, 24);
    expect(recent).toHaveLength(1);
  });
});
