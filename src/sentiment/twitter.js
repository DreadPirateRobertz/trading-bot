// Twitter/X Sentiment Crawler
// Monitors crypto-related tweets via X API v2 (free tier) for sentiment analysis
// Tracks: cashtag mentions, trending hashtags, mention velocity, influencer posts

const DEFAULT_QUERIES = [
  '$BTC OR $ETH OR #Bitcoin OR #Ethereum',
  '$SOL OR $DOGE OR $XRP OR #Solana',
  '#crypto OR #cryptocurrency OR #DeFi',
];

const INFLUENCER_FOLLOWER_THRESHOLD = 10000;

export class TwitterCrawler {
  constructor({
    bearerToken,
    queries,
    fetchFn,
    baseUrl = 'https://api.twitter.com/2',
  } = {}) {
    this.bearerToken = bearerToken || process.env.TWITTER_BEARER_TOKEN;
    this.queries = queries || DEFAULT_QUERIES;
    this.baseUrl = baseUrl;
    this.fetchFn = fetchFn || globalThis.fetch;
    this.rateLimitRemaining = null;
    this.rateLimitReset = null;
  }

  // Search recent tweets matching a query
  // X API v2: GET /2/tweets/search/recent
  async searchRecent(query, { maxResults = 100 } = {}) {
    if (!this.bearerToken) {
      throw new Error('Twitter bearer token required. Set TWITTER_BEARER_TOKEN env var.');
    }

    await this.waitForRateLimit();

    const params = new URLSearchParams({
      query,
      max_results: String(Math.min(maxResults, 100)),
      'tweet.fields': 'created_at,public_metrics,lang',
      'user.fields': 'public_metrics,verified',
      expansions: 'author_id',
    });

    const url = `${this.baseUrl}/tweets/search/recent?${params}`;
    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    });

    this.updateRateLimits(res);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Twitter API error ${res.status}: ${body}`);
    }

    const data = await res.json();

    // Build user lookup from includes
    const users = new Map();
    if (data.includes?.users) {
      for (const user of data.includes.users) {
        users.set(user.id, user);
      }
    }

    if (!data.data) return [];

    return data.data
      .filter(tweet => !tweet.lang || tweet.lang === 'en')
      .map(tweet => {
        const author = users.get(tweet.author_id) || {};
        const metrics = tweet.public_metrics || {};
        const authorMetrics = author.public_metrics || {};

        return {
          id: tweet.id,
          text: tweet.text,
          createdAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
          likes: metrics.like_count || 0,
          retweets: metrics.retweet_count || 0,
          replies: metrics.reply_count || 0,
          quotes: metrics.quote_count || 0,
          authorId: tweet.author_id,
          authorFollowers: authorMetrics.followers_count || 0,
          authorVerified: author.verified || false,
          isInfluencer: (authorMetrics.followers_count || 0) >= INFLUENCER_FOLLOWER_THRESHOLD,
        };
      });
  }

  // Scan all configured queries and aggregate results
  async scanAll({ maxResults = 100 } = {}) {
    const allTweets = [];

    for (const query of this.queries) {
      try {
        const tweets = await this.searchRecent(query, { maxResults });
        allTweets.push(...tweets);
      } catch (err) {
        // Skip failed queries (rate limits, etc.) but continue
        if (err.message.includes('429')) break; // Stop on rate limit
      }
    }

    // Deduplicate by tweet ID
    const seen = new Set();
    return allTweets.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }

  // Extract cashtags ($BTC, $ETH) and crypto tickers from tweet text
  extractCashtags(text) {
    const tags = new Map();

    // Cashtag pattern: $BTC, $ETH, etc.
    const cashtagPattern = /\$([A-Z]{2,10})\b/g;
    for (const match of text.matchAll(cashtagPattern)) {
      const tag = match[1];
      if (!CASHTAG_BLACKLIST.has(tag)) {
        tags.set(tag, (tags.get(tag) || 0) + 1);
      }
    }

    return tags;
  }

  // Calculate mention velocity (mentions per hour) for tracked assets
  computeMentionVelocity(tweets, windowHours = 1) {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const recentTweets = tweets.filter(t => t.createdAt.getTime() > cutoff);

    const velocity = new Map();
    for (const tweet of recentTweets) {
      const tags = this.extractCashtags(tweet.text);
      for (const [tag, count] of tags) {
        velocity.set(tag, (velocity.get(tag) || 0) + count);
      }
    }

    // Normalize to per-hour rate
    return [...velocity.entries()]
      .map(([symbol, count]) => ({
        symbol,
        mentionsPerHour: Math.round(count / windowHours * 100) / 100,
        rawCount: count,
      }))
      .sort((a, b) => b.mentionsPerHour - a.mentionsPerHour);
  }

  // Aggregate ticker mentions with engagement metrics
  aggregateTickerMentions(tweets) {
    const agg = new Map();

    for (const tweet of tweets) {
      const tags = this.extractCashtags(tweet.text);
      for (const [ticker] of tags) {
        const existing = agg.get(ticker) || {
          mentions: 0, totalLikes: 0, totalRetweets: 0,
          tweets: 0, influencerMentions: 0,
        };
        existing.mentions++;
        existing.totalLikes += tweet.likes;
        existing.totalRetweets += tweet.retweets;
        existing.tweets++;
        if (tweet.isInfluencer) existing.influencerMentions++;
        agg.set(ticker, existing);
      }
    }

    return [...agg.entries()]
      .map(([ticker, data]) => ({ ticker, ...data }))
      .sort((a, b) => b.mentions - a.mentions);
  }

  // Wait if rate limited
  async waitForRateLimit() {
    if (this.rateLimitRemaining !== null && this.rateLimitRemaining <= 0 && this.rateLimitReset) {
      const waitMs = this.rateLimitReset * 1000 - Date.now();
      if (waitMs > 0 && waitMs < 900000) { // Max 15 min wait
        await new Promise(resolve => setTimeout(resolve, waitMs + 1000));
      }
    }
  }

  // Update rate limit tracking from response headers
  updateRateLimits(res) {
    const remaining = res.headers?.get?.('x-rate-limit-remaining');
    const reset = res.headers?.get?.('x-rate-limit-reset');
    if (remaining !== null) this.rateLimitRemaining = parseInt(remaining, 10);
    if (reset !== null) this.rateLimitReset = parseInt(reset, 10);
  }
}

// Words that look like cashtags but aren't crypto assets
const CASHTAG_BLACKLIST = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF',
  'USA', 'CEO', 'CFO', 'CTO', 'IPO', 'API', 'NFT',
  'AI', 'ML', 'UI', 'UX', 'QE', 'GDP', 'CPI', 'FED',
]);

export { DEFAULT_QUERIES, CASHTAG_BLACKLIST, INFLUENCER_FOLLOWER_THRESHOLD };
