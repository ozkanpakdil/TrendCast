/**
 * Collectors barrel export.
 *
 * Re-exports all data collectors so the background worker can import
 * them from a single location.
 */

export { collectPolymarketMarkets } from './polymarket';
export { collectKalshiMarkets } from './kalshi';
export { collectRedditSignals } from './reddit';
export { collectNews } from './news';