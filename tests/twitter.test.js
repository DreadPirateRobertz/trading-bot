// Twitter/X Sentiment Crawler Tests
import { describe, it, expect, vi } from 'vitest';
import { TwitterCrawler, DEFAULT_QUERIES, CASHTAG_BLACKLIST, INFLUENCER_FOLLOWER_THRESHOLD } from '../src/sentiment/twitter.js';
import { scoreSentiment, scoreTweet, aggregateScores } from '../src/sentiment/scorer.js';

// Mock X API v2 response
function mockSearchResponse(tweets = [], users = []) {
  return {
    data: tweets.map((t, i) => ({
      id: t.id || `tweet_${i}`,
      text: t.text || 'test tweet',
      created_at: t.created_at || new Date().toISOString(),
      author_id: t.author_id || `user_${i}`,
      lang: t.lang || 'en',
      public_metrics: {
        like_count: t.likes ?? 10,
        retweet_count: t.retweets ?? 5,
        reply_count: t.replies ?? 2,
        quote_count: t.quotes ?? 1,
      },
    })),
    includes: {
      users: users.length > 0 ? users : tweets.map((t, i) => ({
        id: t.author_id || `user_${i}`,
        public_metrics: {
          followers_count: t.followers ?? 500,
        },
        verified: t.verified ?? false,
      })),
    },
  };
}

function createMockFetch(response, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
    headers: {
      get: (name) => {
        if (name === 'x-rate-limit-remaining') return '9';
        if (name === 'x-rate-limit-reset') return String(Math.floor(Date.now() / 1000) + 900);
        return null;
      },
    },
  });
}

describe('TwitterCrawler', () => {
  describe('Construction', () => {
    it('creates with default config', () => {
      const crawler = new TwitterCrawler({ bearerToken: 'test-token' });
      expect(crawler.bearerToken).toBe('test-token');
      expect(crawler.queries).toEqual(DEFAULT_QUERIES);
      expect(crawler.baseUrl).toBe('https://api.twitter.com/2');
    });

    it('accepts custom queries', () => {
      const queries = ['$BTC', '$ETH'];
      const crawler = new TwitterCrawler({ bearerToken: 'test', queries });
      expect(crawler.queries).toEqual(queries);
    });
  });

  describe('searchRecent', () => {
    it('fetches and parses tweets from X API', async () => {
      const mockData = mockSearchResponse([
        { text: '$BTC to the moon! 🚀 Bullish af', likes: 100, retweets: 50, followers: 5000 },
        { text: '$ETH looking bearish, might dump', likes: 20, retweets: 5, followers: 200 },
      ]);
      const mockFetch = createMockFetch(mockData);

      const crawler = new TwitterCrawler({ bearerToken: 'test', fetchFn: mockFetch });
      const tweets = await crawler.searchRecent('$BTC OR $ETH');

      expect(tweets).toHaveLength(2);
      expect(tweets[0].text).toContain('$BTC');
      expect(tweets[0].likes).toBe(100);
      expect(tweets[0].retweets).toBe(50);
      expect(tweets[1].likes).toBe(20);
    });

    it('sends correct authorization header', async () => {
      const mockFetch = createMockFetch(mockSearchResponse([]));
      const crawler = new TwitterCrawler({ bearerToken: 'my-bearer-token', fetchFn: mockFetch });
      await crawler.searchRecent('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tweets/search/recent'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer my-bearer-token' },
        })
      );
    });

    it('throws when no bearer token', async () => {
      const crawler = new TwitterCrawler({ bearerToken: null });
      await expect(crawler.searchRecent('test')).rejects.toThrow('bearer token required');
    });

    it('throws on API error', async () => {
      const mockFetch = createMockFetch({ error: 'unauthorized' }, 401);
      const crawler = new TwitterCrawler({ bearerToken: 'bad-token', fetchFn: mockFetch });
      await expect(crawler.searchRecent('test')).rejects.toThrow('Twitter API error 401');
    });

    it('identifies influencer accounts', async () => {
      const mockData = mockSearchResponse([
        { text: '$BTC bullish', followers: 50000 },
        { text: '$BTC bearish', followers: 100 },
      ]);
      const mockFetch = createMockFetch(mockData);

      const crawler = new TwitterCrawler({ bearerToken: 'test', fetchFn: mockFetch });
      const tweets = await crawler.searchRecent('$BTC');

      expect(tweets[0].isInfluencer).toBe(true);
      expect(tweets[0].authorFollowers).toBe(50000);
      expect(tweets[1].isInfluencer).toBe(false);
    });

    it('filters non-English tweets', async () => {
      const mockData = mockSearchResponse([
        { text: '$BTC moon', lang: 'en' },
        { text: '$BTC luna', lang: 'es' },
        { text: '$BTC whatever', lang: 'en' },
      ]);
      const mockFetch = createMockFetch(mockData);

      const crawler = new TwitterCrawler({ bearerToken: 'test', fetchFn: mockFetch });
      const tweets = await crawler.searchRecent('$BTC');
      expect(tweets).toHaveLength(2);
    });

    it('handles empty response', async () => {
      const mockFetch = createMockFetch({ data: null, includes: {} });
      const crawler = new TwitterCrawler({ bearerToken: 'test', fetchFn: mockFetch });
      const tweets = await crawler.searchRecent('$OBSCURE');
      expect(tweets).toHaveLength(0);
    });
  });

  describe('extractCashtags', () => {
    it('extracts cashtags from tweet text', () => {
      const crawler = new TwitterCrawler({ bearerToken: 'test' });
      const tags = crawler.extractCashtags('$BTC is pumping! $ETH following. $BTC again.');
      expect(tags.get('BTC')).toBe(2);
      expect(tags.get('ETH')).toBe(1);
    });

    it('filters blacklisted cashtags', () => {
      const crawler = new TwitterCrawler({ bearerToken: 'test' });
      const tags = crawler.extractCashtags('$USD $BTC $EUR $ETH $GDP');
      expect(tags.has('USD')).toBe(false);
      expect(tags.has('EUR')).toBe(false);
      expect(tags.has('GDP')).toBe(false);
      expect(tags.get('BTC')).toBe(1);
      expect(tags.get('ETH')).toBe(1);
    });

    it('returns empty map for no cashtags', () => {
      const crawler = new TwitterCrawler({ bearerToken: 'test' });
      const tags = crawler.extractCashtags('just a normal tweet with no cashtags');
      expect(tags.size).toBe(0);
    });
  });

  describe('scanAll', () => {
    it('scans all queries and deduplicates tweets', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        const tweets = callCount === 1
          ? [{ id: 't1', text: '$BTC moon' }, { id: 't2', text: '$ETH pump' }]
          : [{ id: 't2', text: '$ETH pump' }, { id: 't3', text: '$SOL breakout' }];
        return {
          ok: true, status: 200,
          json: async () => mockSearchResponse(tweets),
          headers: { get: () => '9' },
        };
      });

      const crawler = new TwitterCrawler({
        bearerToken: 'test',
        fetchFn: mockFetch,
        queries: ['$BTC', '$ETH'],
      });

      const tweets = await crawler.scanAll();
      // t2 should be deduplicated
      expect(tweets).toHaveLength(3);
      const ids = tweets.map(t => t.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('computeMentionVelocity', () => {
    it('computes mentions per hour for each asset', () => {
      const crawler = new TwitterCrawler({ bearerToken: 'test' });
      const now = new Date();
      const tweets = [
        { text: '$BTC pumping', createdAt: now },
        { text: '$BTC and $ETH moving', createdAt: now },
        { text: '$BTC again', createdAt: new Date(Date.now() - 30 * 60000) },
        { text: '$ETH only', createdAt: new Date(Date.now() - 45 * 60000) },
      ];

      const velocity = crawler.computeMentionVelocity(tweets, 1);
      const btc = velocity.find(v => v.symbol === 'BTC');
      const eth = velocity.find(v => v.symbol === 'ETH');

      expect(btc).toBeDefined();
      expect(btc.rawCount).toBe(3);
      expect(eth).toBeDefined();
      expect(eth.rawCount).toBe(2);
    });

    it('excludes tweets outside window', () => {
      const crawler = new TwitterCrawler({ bearerToken: 'test' });
      const tweets = [
        { text: '$BTC recent', createdAt: new Date() },
        { text: '$BTC old', createdAt: new Date(Date.now() - 3 * 3600000) },
      ];

      const velocity = crawler.computeMentionVelocity(tweets, 1);
      const btc = velocity.find(v => v.symbol === 'BTC');
      expect(btc.rawCount).toBe(1);
    });
  });

  describe('aggregateTickerMentions', () => {
    it('aggregates mentions with engagement metrics', () => {
      const crawler = new TwitterCrawler({ bearerToken: 'test' });
      const tweets = [
        { text: '$BTC moon', likes: 100, retweets: 50, isInfluencer: true },
        { text: '$BTC and $ETH', likes: 20, retweets: 5, isInfluencer: false },
        { text: '$ETH only', likes: 10, retweets: 2, isInfluencer: false },
      ];

      const agg = crawler.aggregateTickerMentions(tweets);
      const btc = agg.find(a => a.ticker === 'BTC');
      const eth = agg.find(a => a.ticker === 'ETH');

      expect(btc.mentions).toBe(2);
      expect(btc.totalLikes).toBe(120);
      expect(btc.influencerMentions).toBe(1);
      expect(eth.mentions).toBe(2);
    });
  });
});

describe('scoreTweet', () => {
  it('scores tweet with engagement weighting', () => {
    const tweet = { likes: 100, retweets: 50, quotes: 10, isInfluencer: false, authorFollowers: 5000 };
    const sentiment = scoreSentiment('$BTC to the moon! Bullish breakout 🚀');
    const scored = scoreTweet(tweet, sentiment);

    expect(scored.source).toBe('twitter');
    expect(scored.engagement).toBeGreaterThan(0);
    expect(scored.weightedScore).toBeGreaterThan(0);
    expect(scored.isInfluencer).toBe(false);
    expect(scored.authorFollowers).toBe(5000);
  });

  it('applies influencer multiplier', () => {
    const sentiment = scoreSentiment('$BTC bullish');
    const regular = scoreTweet(
      { likes: 10, retweets: 5, quotes: 1, isInfluencer: false, authorFollowers: 500 },
      sentiment
    );
    const influencer = scoreTweet(
      { likes: 10, retweets: 5, quotes: 1, isInfluencer: true, authorFollowers: 100000 },
      sentiment
    );

    // Influencer should have 2x weighted score
    expect(influencer.weightedScore).toBe(regular.weightedScore * 2);
  });

  it('handles tweet with zero engagement', () => {
    const sentiment = scoreSentiment('$BTC test');
    const scored = scoreTweet(
      { likes: 0, retweets: 0, quotes: 0, isInfluencer: false },
      sentiment
    );
    expect(scored.engagement).toBeGreaterThanOrEqual(0);
    expect(isFinite(scored.weightedScore)).toBe(true);
  });
});

describe('Twitter + Scoring Pipeline Integration', () => {
  it('full pipeline: fetch → score → aggregate', async () => {
    const mockData = mockSearchResponse([
      { text: '$BTC to the moon! Bullish rally 🚀', likes: 200, retweets: 100, followers: 50000 },
      { text: '$BTC dump incoming, bearish crash', likes: 50, retweets: 20, followers: 3000 },
      { text: '$ETH looking good, buy the dip', likes: 80, retweets: 30, followers: 15000 },
    ]);
    const mockFetch = createMockFetch(mockData);
    const crawler = new TwitterCrawler({ bearerToken: 'test', fetchFn: mockFetch });

    // Fetch
    const tweets = await crawler.searchRecent('$BTC OR $ETH');
    expect(tweets.length).toBeGreaterThan(0);

    // Score each tweet
    const scored = tweets.map(tweet => {
      const sentiment = scoreSentiment(tweet.text);
      return scoreTweet(tweet, sentiment);
    });

    // Aggregate
    const aggregated = aggregateScores(scored);
    expect(aggregated.count).toBe(tweets.length);
    expect(aggregated).toHaveProperty('avgScore');
    expect(aggregated).toHaveProperty('totalWeighted');
    expect(aggregated).toHaveProperty('classification');
    // Bullish tweets outnumber bearish, so should be bullish overall
    expect(['bullish', 'very_bullish']).toContain(aggregated.classification);
  });

  it('bearish tweets produce bearish aggregate', async () => {
    const mockData = mockSearchResponse([
      { text: '$BTC crash dump sell panic!', likes: 100, retweets: 50, followers: 1000 },
      { text: '$BTC rug pull scam bearish', likes: 80, retweets: 40, followers: 500 },
    ]);
    const mockFetch = createMockFetch(mockData);
    const crawler = new TwitterCrawler({ bearerToken: 'test', fetchFn: mockFetch });

    const tweets = await crawler.searchRecent('$BTC');
    const scored = tweets.map(t => scoreTweet(t, scoreSentiment(t.text)));
    const aggregated = aggregateScores(scored);

    expect(['bearish', 'very_bearish']).toContain(aggregated.classification);
    expect(aggregated.avgScore).toBeLessThan(0);
  });
});

describe('Constants', () => {
  it('DEFAULT_QUERIES includes major crypto assets', () => {
    const joined = DEFAULT_QUERIES.join(' ');
    expect(joined).toContain('$BTC');
    expect(joined).toContain('$ETH');
    expect(joined).toContain('#Bitcoin');
  });

  it('CASHTAG_BLACKLIST contains common false positives', () => {
    expect(CASHTAG_BLACKLIST.has('USD')).toBe(true);
    expect(CASHTAG_BLACKLIST.has('EUR')).toBe(true);
    expect(CASHTAG_BLACKLIST.has('CEO')).toBe(true);
    expect(CASHTAG_BLACKLIST.has('BTC')).toBe(false);
  });

  it('INFLUENCER_FOLLOWER_THRESHOLD is reasonable', () => {
    expect(INFLUENCER_FOLLOWER_THRESHOLD).toBeGreaterThanOrEqual(1000);
    expect(INFLUENCER_FOLLOWER_THRESHOLD).toBeLessThanOrEqual(100000);
  });
});
