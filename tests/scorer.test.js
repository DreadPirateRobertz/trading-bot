import { describe, it, expect } from 'vitest';
import { scoreSentiment, scoreRedditPost, aggregateScores } from '../src/sentiment/scorer.js';

describe('scoreSentiment', () => {
  it('scores bullish text positively', () => {
    const result = scoreSentiment('Bitcoin is mooning! Extremely bullish, to the moon!');
    expect(result.score).toBeGreaterThan(0);
    expect(result.classification).toMatch(/bullish/);
  });

  it('scores bearish text negatively', () => {
    const result = scoreSentiment('Massive crash incoming, total dump, this is a scam');
    expect(result.score).toBeLessThan(0);
    expect(result.classification).toMatch(/bearish/);
  });

  it('scores neutral text as neutral', () => {
    const result = scoreSentiment('The market opened today at 9:30 AM');
    expect(result.classification).toBe('neutral');
  });

  it('detects bullish patterns like "buy the dip"', () => {
    const result = scoreSentiment('Time to buy the dip on ETH');
    expect(result.score).toBeGreaterThan(0);
  });

  it('detects bearish patterns like "rug pull"', () => {
    const result = scoreSentiment('This looks like a rug pull');
    expect(result.score).toBeLessThan(0);
  });

  it('returns comparative score normalized by word count', () => {
    const result = scoreSentiment('bullish');
    expect(result.comparative).toBeGreaterThan(0);
    expect(typeof result.comparative).toBe('number');
  });

  it('handles empty string', () => {
    const result = scoreSentiment('');
    expect(result.score).toBe(0);
    expect(result.classification).toBe('neutral');
  });
});

describe('scoreRedditPost', () => {
  it('weights by engagement', () => {
    const post = { score: 1000, numComments: 500 };
    const sentiment = scoreSentiment('This is extremely bullish, mooning!');
    const result = scoreRedditPost(post, sentiment);
    expect(result.engagement).toBeGreaterThan(0);
    expect(Math.abs(result.weightedScore)).toBeGreaterThan(Math.abs(sentiment.score));
  });
});

describe('aggregateScores', () => {
  it('aggregates multiple scores', () => {
    const scores = [
      { score: 5, weightedScore: 10, classification: 'bullish' },
      { score: 3, weightedScore: 6, classification: 'bullish' },
      { score: -1, weightedScore: -2, classification: 'bearish' },
    ];
    const result = aggregateScores(scores);
    expect(result.avgScore).toBeGreaterThan(0);
    expect(result.totalWeighted).toBe(14);
    expect(result.count).toBe(3);
  });

  it('handles empty array', () => {
    const result = aggregateScores([]);
    expect(result.avgScore).toBe(0);
    expect(result.classification).toBe('neutral');
    expect(result.count).toBe(0);
  });
});
