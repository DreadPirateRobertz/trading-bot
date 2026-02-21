// Sentiment Scorer
// Combines AFINN-style lexicon with custom financial keywords

// AFINN-style word scores (subset focused on financial context)
// Full implementation would use the `sentiment` npm package
const WORD_SCORES = {
  // Positive financial
  bullish: 3, moon: 3, mooning: 3, rocket: 3, breakout: 3, rally: 3, surge: 3,
  soar: 3, pump: 2, rip: 2, buy: 1, long: 1, calls: 1, upside: 2, gains: 2,
  profit: 2, winner: 2, squeeze: 2, parabolic: 3, undervalued: 2,
  // Positive general
  good: 1, great: 2, amazing: 3, awesome: 3, excellent: 3, love: 2,
  // Negative financial
  bearish: -3, crash: -3, dump: -3, dumping: -3, rug: -3, rekt: -3,
  short: -1, puts: -1, sell: -1, overvalued: -2, bag: -2, bagholder: -3,
  scam: -3, fraud: -3, ponzi: -3, bubble: -2, capitulate: -3, correction: -2,
  // Negative general
  bad: -1, terrible: -3, awful: -3, worst: -3, hate: -2, fear: -2, panic: -3,
};

const BULLISH_PATTERNS = [
  /\bto the moon\b/i,
  /\bbuy the dip\b/i,
  /\bdiamond hands?\b/i,
  /\ball.?time high\b/i,
  /\bATH\b/,
  /\bLFG\b/,
  /\bbull run\b/i,
  /🚀/,
  /💎/,
];

const BEARISH_PATTERNS = [
  /\brug pull\b/i,
  /\bsell.?off\b/i,
  /\bdead cat bounce\b/i,
  /\bpaper hands?\b/i,
  /\bget out\b/i,
  /\bgoing to zero\b/i,
  /\bhead and shoulders\b/i,
  /📉/,
];

export function scoreSentiment(text) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  // Word-level scoring
  let wordScore = 0;
  let wordHits = 0;
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (WORD_SCORES[clean] !== undefined) {
      wordScore += WORD_SCORES[clean];
      wordHits++;
    }
  }

  // Pattern-level scoring
  let patternScore = 0;
  for (const pattern of BULLISH_PATTERNS) {
    if (pattern.test(text)) patternScore += 2;
  }
  for (const pattern of BEARISH_PATTERNS) {
    if (pattern.test(text)) patternScore -= 2;
  }

  const totalScore = wordScore + patternScore;
  const comparative = words.length > 0 ? totalScore / words.length : 0;

  return {
    score: totalScore,
    comparative,
    wordHits,
    classification: classify(totalScore),
  };
}

function classify(score) {
  if (score >= 3) return 'very_bullish';
  if (score >= 1) return 'bullish';
  if (score <= -3) return 'very_bearish';
  if (score <= -1) return 'bearish';
  return 'neutral';
}

export function scoreRedditPost(post, sentimentResult) {
  // Weight sentiment by engagement (upvotes + comments)
  const engagement = Math.log2(Math.max(post.score || 1, 1)) +
    Math.log2(Math.max(post.numComments || 1, 1));
  return {
    ...sentimentResult,
    engagement,
    weightedScore: sentimentResult.score * engagement,
  };
}

export function scoreNewsArticle(article, sentimentResult) {
  // News gets a flat weight — no engagement metrics
  return {
    ...sentimentResult,
    source: article.source,
    weightedScore: sentimentResult.score * 1.5,  // News slightly amplified
  };
}

export function scoreTweet(tweet, sentimentResult) {
  // Weight by engagement: likes + retweets + quotes, log-scaled
  const engagement = Math.log2(Math.max(tweet.likes || 0, 1))
    + Math.log2(Math.max(tweet.retweets || 0, 1)) * 1.5  // Retweets weighted more (amplification)
    + Math.log2(Math.max(tweet.quotes || 0, 1)) * 1.2;   // Quotes indicate discourse

  // Influencer boost: high-follower accounts get 2x weight
  const influencerMultiplier = tweet.isInfluencer ? 2.0 : 1.0;

  return {
    ...sentimentResult,
    source: 'twitter',
    engagement,
    authorFollowers: tweet.authorFollowers || 0,
    isInfluencer: tweet.isInfluencer || false,
    weightedScore: sentimentResult.score * engagement * influencerMultiplier,
  };
}

export function aggregateScores(scores) {
  if (scores.length === 0) return { avgScore: 0, totalWeighted: 0, classification: 'neutral', count: 0 };
  const totalWeighted = scores.reduce((s, r) => s + r.weightedScore, 0);
  const avgScore = scores.reduce((s, r) => s + r.score, 0) / scores.length;
  return {
    avgScore: Math.round(avgScore * 100) / 100,
    totalWeighted: Math.round(totalWeighted * 100) / 100,
    classification: classify(avgScore),
    count: scores.length,
  };
}

export { WORD_SCORES, BULLISH_PATTERNS, BEARISH_PATTERNS };
