import { describe, it, expect } from 'vitest';
import { RedditCrawler } from '../src/sentiment/reddit.js';

describe('RedditCrawler', () => {
  describe('extractTickers', () => {
    const crawler = new RedditCrawler();

    it('extracts $TICKER format', () => {
      const tickers = crawler.extractTickers('Just bought $AAPL and $TSLA');
      expect(tickers.get('AAPL')).toBe(1);
      expect(tickers.get('TSLA')).toBe(1);
    });

    it('extracts uppercase tickers without $', () => {
      const tickers = crawler.extractTickers('NVDA is going parabolic');
      expect(tickers.get('NVDA')).toBe(1);
    });

    it('filters blacklisted words', () => {
      const tickers = crawler.extractTickers('THE YOLO FOMO on THIS stock');
      expect(tickers.has('THE')).toBe(false);
      expect(tickers.has('YOLO')).toBe(false);
      expect(tickers.has('FOMO')).toBe(false);
      expect(tickers.has('THIS')).toBe(false);
    });

    it('counts multiple mentions', () => {
      const tickers = crawler.extractTickers('$AAPL up, $AAPL strong, $AAPL moon');
      expect(tickers.get('AAPL')).toBe(3);
    });

    it('returns empty map for no tickers', () => {
      const tickers = crawler.extractTickers('just a regular sentence with no tickers');
      expect(tickers.size).toBe(0);
    });
  });

  describe('aggregateTickerMentions', () => {
    const crawler = new RedditCrawler();

    it('aggregates mentions across posts', () => {
      const posts = [
        { tickers: { AAPL: 2, TSLA: 1 }, score: 100, numComments: 50 },
        { tickers: { AAPL: 1, NVDA: 3 }, score: 200, numComments: 80 },
      ];
      const result = crawler.aggregateTickerMentions(posts);
      const aapl = result.find(t => t.ticker === 'AAPL');
      expect(aapl.mentions).toBe(3);
      expect(aapl.posts).toBe(2);
      expect(aapl.totalScore).toBe(300);
    });

    it('sorts by mention count descending', () => {
      const posts = [
        { tickers: { AAPL: 1 }, score: 10, numComments: 5 },
        { tickers: { TSLA: 5 }, score: 20, numComments: 10 },
      ];
      const result = crawler.aggregateTickerMentions(posts);
      expect(result[0].ticker).toBe('TSLA');
    });
  });
});
