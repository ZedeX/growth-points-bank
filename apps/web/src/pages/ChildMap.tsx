import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

const DIMENSION_LABEL: Record<string, string> = {
  learning: '学习力',
  sports: '运动力',
  self_control: '自控力',
  exploration: '探索力',
  practice: '实践力',
};

export default function ChildMap() {
  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: () => api.getBalance(),
  });

  const { data: checkinsData } = useQuery({
    queryKey: ['checkins'],
    queryFn: () => api.getCheckins(),
  });

  const { data: historyData } = useQuery({
    queryKey: ['history'],
    queryFn: () => api.getHistory(),
  });

  const { data: tasksData } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.getTasks(),
  });

  const { data: rewardsData } = useQuery({
    queryKey: ['rewards'],
    queryFn: () => api.getRewards(),
  });

  const balance = balanceData?.balance ?? 0;
  const checkins = checkinsData?.checkins || [];
  const history = historyData?.history || [];
  const tasks = tasksData?.tasks || [];
  const rewards = rewardsData?.rewards || [];

  // Aggregate points by dimension from task history
  const dimPoints = new Map<string, number>();
  for (const t of tasks) {
    const dimId = t.dimension_id || t.dimensionId;
    const dim = t.dimension;
    if (dim) {
      dimPoints.set(dim.code, (dimPoints.get(dim.code) || 0));
    }
  }
  for (const c of checkins) {
    const dimId = c.dimensionId;
    const task = tasks.find((t: any) => (t.id) === c.taskId);
    const dim = task?.dimension;
    if (dim) {
      const pts = Math.round((task.point_value || task.pointValue) * (task.difficulty_multiplier || task.difficultyMultiplier || 100) / 100);
      dimPoints.set(dim.code, (dimPoints.get(dim.code) || 0) + (c.revoked ? 0 : pts));
    }
  }

  // Weekly check-in count
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekCheckins = checkins.filter((c: any) => !c.revoked && new Date(c.date) >= weekStart);

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">成长地图</h1>

      {/* Balance Card */}
      <div className="bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-2xl p-6 mb-6">
        <div className="text-sm opacity-90">我的积分余额</div>
        <div className="text-4xl font-bold mt-2">{balance}</div>
        <div className="text-sm opacity-80 mt-3">
          本周打卡 {weekCheckins.length} 次
        </div>
      </div>

      {/* Dimensions Radar */}
      <h2 className="text-lg font-semibold text-gray-800 mb-3">五维成长</h2>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {Object.entries(DIMENSION_LABEL).map(([code, label]) => {
          const points = dimPoints.get(code) || 0;
          const colors: Record<string, string> = {
            learning: '#2196F3',
            sports: '#FF9800',
            self_control: '#9C27B0',
            exploration: '#4CAF50',
            practice: '#F44336',
          };
          return (
            <div
              key={code}
              className="bg-white rounded-xl p-4 shadow-sm"
              style={{ borderLeft: `4px solid ${colors[code]}` }}
            >
              <div className="text-sm text-gray-600">{label}</div>
              <div className="text-2xl font-bold mt-1" style={{ color: colors[code] }}>
                {points}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent check-ins */}
      <h2 className="text-lg font-semibold text-gray-800 mb-3">最近打卡</h2>
      {checkins.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center text-gray-500 text-sm">
          还没有打卡记录，去"打卡"页面完成任务吧！
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {checkins.slice(0, 10).map((c: any) => (
            <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-800">
                  {c.taskTitle}
                  {c.revoked && <span className="ml-2 text-xs text-red-500">已撤销</span>}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {c.date} · {new Date(c.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className="text-sm text-brand-600 font-medium">
                +{c.taskPointValue}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent points history */}
      <h2 className="text-lg font-semibold text-gray-800 mb-3">积分流水</h2>
      {history.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center text-gray-500 text-sm">
          暂无积分记录
        </div>
      ) : (
        <div className="space-y-1">
          {history.slice(0, 10).map((h: any) => (
            <div key={h.id} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between text-sm">
              <div>
                <span className={h.amount > 0 ? 'text-green-600' : 'text-red-500'}>
                  {h.amount > 0 ? '+' : ''}{h.amount}
                </span>
                <span className="text-gray-400 ml-2 text-xs">
                  {h.source_type === 'task' ? '打卡' : h.source_type === 'reward' ? '兑换' : '撤销'}
                </span>
              </div>
              <span className="text-gray-400 text-xs">
                {new Date(h.created_at || h.createdAt).toLocaleString('zh-CN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
