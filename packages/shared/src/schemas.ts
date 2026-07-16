import { z } from 'zod';

// === Auth ===
export const loginSchema = z.object({
  email_or_phone: z.string().min(1),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
  family_name: z.string().min(1).max(100),
  parent_name: z.string().min(1).max(100),
}).refine(d => d.email || d.phone, { message: 'email or phone required' });
export type RegisterInput = z.infer<typeof registerSchema>;

// === Family ===
export const familySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string(),
});
export type Family = z.infer<typeof familySchema>;

// === Child ===
export const createChildSchema = z.object({
  name: z.string().min(1).max(50),
  age_group: z.enum(['6-8', '9-11', '12-14']),
  avatar: z.string().url().nullish(),
});
export type CreateChildInput = z.infer<typeof createChildSchema>;

export const childSchema = z.object({
  id: z.string().uuid(),
  family_id: z.string().uuid(),
  name: z.string(),
  age_group: z.enum(['6-8', '9-11', '12-14']),
  avatar: z.string().nullable(),
  access_token_expires_at: z.string().nullable(),
  token_version: z.number(),
  created_at: z.string(),
});
export type Child = z.infer<typeof childSchema>;

// === Dimensions ===
export const dimensionSchema = z.object({
  id: z.string().uuid(),
  family_id: z.string().uuid().nullable(),
  code: z.string(),
  name: z.string(),
  color: z.string(),
  is_default: z.boolean(),
  sort_order: z.number(),
});
export type Dimension = z.infer<typeof dimensionSchema>;

// === Tasks ===
export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  dimension_id: z.string().uuid(),
  point_value: z.number().int().min(1).max(100),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  age_group: z.enum(['6-8', '9-11', '12-14']),
  is_active: z.boolean().default(true),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const taskSchema = z.object({
  id: z.string().uuid(),
  family_id: z.string().uuid(),
  dimension_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  point_value: z.number().int(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  difficulty_multiplier: z.number(),
  frequency: z.enum(['daily', 'weekly']),
  age_group: z.enum(['6-8', '9-11', '12-14']),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

// === Check-ins ===
export const createCheckinSchema = z.object({
  task_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
});
export type CreateCheckinInput = z.infer<typeof createCheckinSchema>;

// === Rewards ===
export const createRewardSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  point_cost: z.number().int().min(1).max(10000),
  total_inventory: z.number().int().min(1).default(999),
  weekly_limit_per_child: z.number().int().min(0).default(1),
  icon: z.string().optional(),
});
export type CreateRewardInput = z.infer<typeof createRewardSchema>;

// === Redemption ===
export const createRedemptionSchema = z.object({
  reward_id: z.string().uuid(),
});
export type CreateRedemptionInput = z.infer<typeof createRedemptionSchema>;

export const updateRedemptionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'fulfilled', 'cancelled']),
  parent_note: z.string().max(500).optional(),
});
export type UpdateRedemptionInput = z.infer<typeof updateRedemptionSchema>;

// === Weekly Review ===
export const submitChildReviewSchema = z.object({
  week_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  best_thing: z.string().max(1000),
  difficulty: z.string().max(1000),
  child_request: z.string().max(1000),
});
export type SubmitChildReviewInput = z.infer<typeof submitChildReviewSchema>;

export const submitParentReviewSchema = z.object({
  week_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  parent_observation: z.string().max(2000),
});
export type SubmitParentReviewInput = z.infer<typeof submitParentReviewSchema>;

// === Growth Diary ===
export const createDiarySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  category: z.enum(['achievement', 'reflection', 'goal', 'memory']).default('reflection'),
  week_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateDiaryInput = z.infer<typeof createDiarySchema>;

// === API Response ===
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    details: z.any().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
