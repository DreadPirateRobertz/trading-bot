// Reddit Sentiment Crawler
// Monitors subreddits for ticker mentions and sentiment

const DEFAULT_SUBREDDITS = [
  'wallstreetbets',
  'CryptoCurrency',
  'stocks',
  'options',
];

// Common ticker patterns — excludes very short/common words
const TICKER_PATTERN = /\$([A-Z]{2,5})\b|\b([A-Z]{3,5})\b/g;

// Words that look like tickers but aren't
const TICKER_BLACKLIST = new Set([
  'THE', 'FOR', 'AND', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS',
  'ONE', 'OUR', 'OUT', 'ARE', 'HAS', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW',
  'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'DID', 'GET', 'HIM', 'LET', 'SAY',
  'SHE', 'TOO', 'USE', 'DAD', 'MOM', 'IMO', 'TBH', 'LOL', 'OMG', 'WTF',
  'LMAO', 'YOLO', 'FOMO', 'HODL', 'EDIT', 'THIS', 'THAT', 'WITH', 'FROM',
  'JUST', 'LIKE', 'BEEN', 'HAVE', 'WILL', 'WHAT', 'WHEN', 'YOUR', 'SOME',
  'THEM', 'THAN', 'EACH', 'MAKE', 'VERY', 'MUCH', 'ALSO', 'BACK', 'LONG',
  'SHORT', 'BULL', 'BEAR', 'PUTS', 'CALL', 'PUMP', 'DUMP', 'MOON',
]);

export class RedditCrawler {
  constructor({ clientId, clientSecret, username, password, userAgent } = {}) {
    this.clientId = clientId || process.env.REDDIT_CLIENT_ID;
    this.clientSecret = clientSecret || process.env.REDDIT_CLIENT_SECRET;
    this.username = username || process.env.REDDIT_USERNAME;
    this.password = password || process.env.REDDIT_PASSWORD;
    this.userAgent = userAgent || 'tradingbot:v0.1.0 (by /u/tradingbot)';
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.subreddits = DEFAULT_SUBREDDITS;
  }

  async authenticate() {
    if (this.accessToken && Date.now() < this.tokenExpiry) return;

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: this.username,
        password: this.password,
      }),
    });
    if (!res.ok) throw new Error(`Reddit auth error: ${res.status}`);
    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  }

  async fetchSubreddit(subreddit, { sort = 'hot', limit = 25 } = {}) {
    await this.authenticate();
    const res = await fetch(
      `https://oauth.reddit.com/r/${subreddit}/${sort}?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'User-Agent': this.userAgent,
        },
      }
    );
    if (!res.ok) throw new Error(`Reddit fetch error: ${res.status}`);
    const data = await res.json();
    return data.data.children.map(c => c.data);
  }

  extractTickers(text) {
    const tickers = new Map();
    const matches = text.matchAll(TICKER_PATTERN);
    for (const match of matches) {
      const ticker = match[1] || match[2];
      if (!TICKER_BLACKLIST.has(ticker)) {
        tickers.set(ticker, (tickers.get(ticker) || 0) + 1);
      }
    }
    return tickers;
  }

  async scanSubreddits({ sort = 'hot', limit = 25 } = {}) {
    const results = [];
    for (const sub of this.subreddits) {
      const posts = await this.fetchSubreddit(sub, { sort, limit });
      for (const post of posts) {
        const text = `${post.title} ${post.selftext || ''}`;
        const tickers = this.extractTickers(text);
        if (tickers.size > 0) {
          results.push({
            subreddit: sub,
            title: post.title,
            score: post.score,
            numComments: post.num_comments,
            created: post.created_utc,
            tickers: Object.fromEntries(tickers),
            url: `https://reddit.com${post.permalink}`,
          });
        }
      }
    }
    return results;
  }

  aggregateTickerMentions(posts) {
    const agg = new Map();
    for (const post of posts) {
      for (const [ticker, count] of Object.entries(post.tickers)) {
        const existing = agg.get(ticker) || { mentions: 0, totalScore: 0, posts: 0 };
        existing.mentions += count;
        existing.totalScore += post.score;
        existing.posts += 1;
        agg.set(ticker, existing);
      }
    }
    return [...agg.entries()]
      .map(([ticker, data]) => ({ ticker, ...data }))
      .sort((a, b) => b.mentions - a.mentions);
  }
}

export { TICKER_BLACKLIST, TICKER_PATTERN };
