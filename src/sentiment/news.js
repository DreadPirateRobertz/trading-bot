// News RSS Crawler
// Fetches financial news from RSS feeds for sentiment analysis

const DEFAULT_FEEDS = [
  {
    name: 'CoinDesk',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    category: 'crypto',
  },
  {
    name: 'Cointelegraph',
    url: 'https://cointelegraph.com/rss',
    category: 'crypto',
  },
  {
    name: 'CNBC Markets',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135',
    category: 'traditional',
  },
];

export class NewsCrawler {
  constructor({ feeds, parseXml } = {}) {
    this.feeds = feeds || DEFAULT_FEEDS;
    // parseXml should be an async function that takes XML string and returns
    // { items: [{ title, link, pubDate, content }] }
    // In production, use rss-parser: new RssParser().parseString(xml)
    this.parseXml = parseXml || defaultXmlParser;
  }

  async fetchFeed(feed) {
    const res = await fetch(feed.url);
    if (!res.ok) throw new Error(`News feed error (${feed.name}): ${res.status}`);
    const xml = await res.text();
    const parsed = await this.parseXml(xml);
    return parsed.items.map(item => ({
      source: feed.name,
      category: feed.category,
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate ? new Date(item.pubDate) : null,
      content: item.content || item.description || '',
    }));
  }

  async fetchAllFeeds() {
    const results = await Promise.allSettled(
      this.feeds.map(feed => this.fetchFeed(feed))
    );
    const articles = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        articles.push(...result.value);
      }
    }
    return articles.sort((a, b) => {
      if (!a.pubDate || !b.pubDate) return 0;
      return b.pubDate.getTime() - a.pubDate.getTime();
    });
  }

  filterRecent(articles, hoursBack = 24) {
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
    return articles.filter(a => a.pubDate && a.pubDate.getTime() > cutoff);
  }
}

// Minimal XML parser for RSS — extracts items from <item> tags
// Production should use rss-parser npm package
function defaultXmlParser(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      description: extractTag(block, 'description'),
      content: extractTag(block, 'content:encoded') || extractTag(block, 'description'),
    });
  }
  return { items };
}

function extractTag(xml, tag) {
  const cdataMatch = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
  const plainMatch = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(cdataMatch) || xml.match(plainMatch);
  return m ? m[1].trim() : '';
}

export { DEFAULT_FEEDS, defaultXmlParser };
