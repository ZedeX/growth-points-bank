// Error codes (from ADR-0013)
export const ErrorCode = {
  // Auth (1xxx)
  UNAUTHORIZED: 1001,
  FORBIDDEN: 1002,
  INVALID_CREDENTIALS: 1003,
  TOKEN_EXPIRED: 1004,
  TOKEN_INVALID: 1005,
  RATE_LIMITED: 1006,
  // Multi-tenant (2xxx)
  CROSS_FAMILY_ACCESS: 2001,
  FAMILY_NOT_FOUND: 2002,
  // Points (3xxx)
  INSUFFICIENT_BALANCE: 3001,
  DUPLICATE_CHECKIN: 3002,
  SERIALIZATION_CONFLICT: 3003,
  // Rewards (4xxx)
  REWARD_OUT_OF_STOCK: 4001,
  REWARD_WEEKLY_LIMIT: 4002,
  REWARD_NOT_AVAILABLE: 4003,
  INVALID_REDEMPTION_STATE: 4004,
  // Tasks (5xxx)
  TASK_NOT_FOUND: 5001,
  TASK_AGE_GROUP_MISMATCH: 5002,
  // Reviews (6xxx)
  REVIEW_ALREADY_LOCKED: 6001,
  REVIEW_NOT_READY: 6002,
  // Generic (9xxx)
  VALIDATION_ERROR: 9001,
  NOT_FOUND: 9002,
  INTERNAL_ERROR: 9003,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// Dimension colors (from PRD §3.1)
export const DIMENSION_COLORS = {
  learning: '#2196F3',      // 学习力 - Blue
  sports: '#FF9800',        // 运动力 - Orange
  self_control: '#9C27B0',  // 自控力 - Purple
  exploration: '#4CAF50',   // 探索力 - Green
  practice: '#F44336',      // 实践力 - Red
} as const;

export const DIMENSION_NAMES = {
  learning: '学习力',
  sports: '运动力',
  self_control: '自控力',
  exploration: '探索力',
  practice: '实践力',
} as const;

export const AGE_GROUPS = ['6-8', '9-11', '12-14'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export const TASK_FREQUENCY = ['daily', 'weekly'] as const;
export type TaskFrequency = (typeof TASK_FREQUENCY)[number];

export const REDEMPTION_STATUS = ['pending', 'approved', 'rejected', 'fulfilled', 'cancelled'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUS)[number];

export const DIFFICULTY_MULTIPLIERS = { easy: 1, medium: 1.5, hard: 2 } as const;
export type Difficulty = keyof typeof DIFFICULTY_MULTIPLIERS;
