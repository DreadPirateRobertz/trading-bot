// Sentiment Module
// Reddit crawler, news crawler, and sentiment scoring

export { RedditCrawler } from './reddit.js';
export { NewsCrawler } from './news.js';
export {
  scoreSentiment,
  scoreRedditPost,
  scoreNewsArticle,
  aggregateScores,
} from './scorer.js';
