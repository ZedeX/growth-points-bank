import { db, schema } from './client.js';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('[seed] Checking for existing data...');

  // Check if any family exists
  const [existing] = await db.select().from(schema.families).limit(1);
  if (existing) {
    console.log('[seed] Database already has data. Skipping seed.');
    process.exit(0);
  }

  console.log('[seed] Creating demo family...');

  // Create demo family
  const [family] = await db.insert(schema.families).values({
    name: '示范家庭',
  }).returning();

  // Seed default dimensions
  const dimensions = [
    { code: 'learning', name: '学习力', color: '#2196F3', sortOrder: 1 },
    { code: 'sports', name: '运动力', color: '#FF9800', sortOrder: 2 },
    { code: 'self_control', name: '自控力', color: '#9C27B0', sortOrder: 3 },
    { code: 'exploration', name: '探索力', color: '#4CAF50', sortOrder: 4 },
    { code: 'practice', name: '实践力', color: '#F44336', sortOrder: 5 },
  ];

  const createdDims = [];
  for (const d of dimensions) {
    const [dim] = await db.insert(schema.growthDimensions).values({
      familyId: family.id,
      code: d.code,
      name: d.name,
      color: d.color,
      isDefault: true,
      sortOrder: d.sortOrder,
    }).returning();
    createdDims.push(dim);
  }
  console.log(`[seed] Created ${createdDims.length} dimensions`);

  // Seed task templates (3 per dimension × 3 age groups = 45 tasks)
  const ageGroups = ['6-8', '9-11', '12-14'];
  const taskTemplates: Record<string, Record<string, { title: string; points: number; difficulty: string }[]>> = {
    learning: {
      '6-8': [
        { title: '完成课外阅读20分钟', points: 2, difficulty: 'easy' },
        { title: '完成口算练习', points: 3, difficulty: 'easy' },
        { title: '背诵古诗一首', points: 4, difficulty: 'medium' },
      ],
      '9-11': [
        { title: '完成当天作业', points: 3, difficulty: 'easy' },
        { title: '阅读英文绘本', points: 4, difficulty: 'medium' },
        { title: '写读书笔记', points: 5, difficulty: 'hard' },
      ],
      '12-14': [
        { title: '完成当天作业', points: 3, difficulty: 'easy' },
        { title: '预习新课程', points: 5, difficulty: 'medium' },
        { title: '完成拓展练习', points: 6, difficulty: 'hard' },
      ],
    },
    sports: {
      '6-8': [
        { title: '跳绳100下', points: 2, difficulty: 'easy' },
        { title: '户外运动30分钟', points: 3, difficulty: 'easy' },
        { title: '学会一个运动新技能', points: 5, difficulty: 'hard' },
      ],
      '9-11': [
        { title: '跑步15分钟', points: 3, difficulty: 'easy' },
        { title: '游泳/球类运动40分钟', points: 4, difficulty: 'medium' },
        { title: '完成体能训练', points: 5, difficulty: 'hard' },
      ],
      '12-14': [
        { title: '跑步20分钟', points: 3, difficulty: 'easy' },
        { title: '球类运动1小时', points: 5, difficulty: 'medium' },
        { title: '突破运动个人记录', points: 7, difficulty: 'hard' },
      ],
    },
    self_control: {
      '6-8': [
        { title: '按时起床不赖床', points: 2, difficulty: 'easy' },
        { title: '自己整理书包', points: 3, difficulty: 'easy' },
        { title: '不看电视超过30分钟', points: 4, difficulty: 'medium' },
      ],
      '9-11': [
        { title: '按时完成所有任务', points: 3, difficulty: 'easy' },
        { title: '自主安排学习时间', points: 4, difficulty: 'medium' },
        { title: '控制电子产品使用时间', points: 5, difficulty: 'hard' },
      ],
      '12-14': [
        { title: '制定并执行每日计划', points: 4, difficulty: 'medium' },
        { title: '早睡早起不熬夜', points: 3, difficulty: 'easy' },
        { title: '坚持习惯打卡21天', points: 7, difficulty: 'hard' },
      ],
    },
    exploration: {
      '6-8': [
        { title: '观察自然并记录', points: 3, difficulty: 'easy' },
        { title: '做一个小实验', points: 4, difficulty: 'medium' },
        { title: '参观博物馆/科技馆', points: 5, difficulty: 'medium' },
      ],
      '9-11': [
        { title: '研究一个感兴趣的问题', points: 4, difficulty: 'medium' },
        { title: '学习一项新技能', points: 5, difficulty: 'hard' },
        { title: '参加户外探索活动', points: 5, difficulty: 'medium' },
      ],
      '12-14': [
        { title: '独立完成一次调研', points: 6, difficulty: 'hard' },
        { title: '学习编程/新工具', points: 5, difficulty: 'medium' },
        { title: '参加科学竞赛', points: 7, difficulty: 'hard' },
      ],
    },
    practice: {
      '6-8': [
        { title: '帮做家务', points: 2, difficulty: 'easy' },
        { title: '自己洗碗/整理', points: 3, difficulty: 'easy' },
        { title: '给家人做一件小事', points: 4, difficulty: 'medium' },
      ],
      '9-11': [
        { title: '做一顿简单饭菜', points: 5, difficulty: 'medium' },
        { title: '参与社区志愿活动', points: 5, difficulty: 'hard' },
        { title: '修理家中物品', points: 4, difficulty: 'medium' },
      ],
      '12-14': [
        { title: '独立完成家庭采购', points: 5, difficulty: 'medium' },
        { title: '参加社会实践', points: 7, difficulty: 'hard' },
        { title: '做完整一顿饭', points: 6, difficulty: 'medium' },
      ],
    },
  };

  const DIFFICULTY_MULT: Record<string, number> = { easy: 100, medium: 150, hard: 200 };
  let taskCount = 0;

  for (const dim of createdDims) {
    const templates = taskTemplates[dim.code];
    if (!templates) continue;

    for (const ageGroup of ageGroups) {
      for (const t of templates[ageGroup]) {
        await db.insert(schema.tasks).values({
          familyId: family.id,
          dimensionId: dim.id,
          title: t.title,
          pointValue: t.points,
          difficulty: t.difficulty,
          difficultyMultiplier: DIFFICULTY_MULT[t.difficulty],
          frequency: 'daily',
          ageGroup,
          isActive: true,
        });
        taskCount++;
      }
    }
  }

  console.log(`[seed] Created ${taskCount} task templates`);
  console.log('[seed] Seed completed successfully!');
  console.log(`[seed] Demo family ID: ${family.id}`);
  console.log('[seed] Register a parent account via POST /api/auth/register to start.');
  process.exit(0);
}

seed().catch(err => {
  console.error('[seed] Seed failed:', err);
  process.exit(1);
});
