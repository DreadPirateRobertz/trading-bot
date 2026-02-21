// Sentiment Module
// Reddit crawler, news crawler, Twitter/X crawler, and sentiment scoring

export { RedditCrawler } from './reddit.js';
export { NewsCrawler } from './news.js';
export { TwitterCrawler } from './twitter.js';
export {
  scoreSentiment,
  scoreRedditPost,
  scoreNewsArticle,
  scoreTweet,
  aggregateScores,
} from './scorer.js';
