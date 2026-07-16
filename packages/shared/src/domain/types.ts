// Domain types for pure business logic functions.
// These are minimal interfaces used by the domain layer; they decouple
// the pure functions from the Drizzle ORM schema types.

export interface DomainTask {
  id: string;
  family_id: string;
  dimension_id: number | string;
  title: string;
  point_value: number;
  frequency: 'daily' | 'weekly';
  difficulty?: 'easy' | 'medium' | 'hard';
  age_group?: string;
  is_active: boolean;
}

export interface DomainCheckIn {
  id: string;
  child_id: string;
  task_id: string;
  date: string; // ISO date string YYYY-MM-DD
  revoked_by_parent: boolean;
  revoked_at: string | null;
}

export interface DomainReward {
  id: string;
  family_id: string;
  title: string;
  point_cost: number;
  total_inventory: number;
  total_claimed: number;
  weekly_limit_per_child: number;
  is_active: boolean;
}

export interface DomainRedemption {
  id: string;
  child_id: string;
  reward_id: string;
  point_cost: number;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled' | 'cancelled';
}

export interface DomainDimension {
  id: number;
  family_id: string | null;
  code: string;
  name: string;
  color: string;
  sort_order: number;
}

export type DimensionStatus = 'none' | 'partial' | 'complete';

export interface RedemptionCheckResult {
  ok: boolean;
  shortfall?: number;
}
