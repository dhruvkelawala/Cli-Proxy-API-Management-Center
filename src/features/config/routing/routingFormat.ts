import type { RoutingStrategy } from '@/types/visualConfig';

/** Friendly strategy labels. The backend value is shown separately in mono. */
export const STRATEGY_LABEL_KEYS: Record<RoutingStrategy, string> = {
  'round-robin': 'config_management.routing_settings.strategy.round_robin',
  'weighted-round-robin': 'config_management.routing_settings.strategy.weighted_round_robin',
  'fill-first': 'config_management.routing_settings.strategy.fill_first',
};

/** Whole percents when exact, otherwise one decimal (e.g. 33.3%). */
export const formatSharePercent = (percent: number): string => {
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
};
