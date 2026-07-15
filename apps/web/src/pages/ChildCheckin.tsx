import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

const DIFFICULTY_LABEL: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' };
const DIFFICULTY_COLOR: Record<string, string> = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
};

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function ChildCheckin() {
  const queryClient = useQueryClient();
  const today = todayStr();
  const [note, setNote] = useState<Record<string, string>>({});

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.getTasks(),
  });

  const { data: checkinsData } = useQuery({
    queryKey: ['checkins'],
    queryFn: () => api.getCheckins(),
  });

  const createCheckinMut = useMutation({
    mutationFn: (data: { task_id: string; date: string; note?: string }) => api.createCheckin(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkins'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });

  const tasks = tasksData?.tasks || [];
  const todayCheckins = (checkinsData?.checkins || []).filter((c: any) => c.date === today);
  const checkedTaskIds = new Set(todayCheckins.map((c: any) => c.taskId));

  // Group tasks by dimension
  const tasksByDim = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of tasks) {
      const dimId = t.dimension_id || t.dimensionId;
      if (!map.has(dimId)) map.set(dimId, []);
      map.get(dimId)!.push(t);
    }
    return map;
  }, [tasks]);

  const dimMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of tasks) {
      const dim = t.dimension;
      if (dim) m.set(dim.id, dim);
    }
    return m;
  }, [tasks]);

  function handleCheckin(taskId: string) {
    createCheckinMut.mutate({
      task_id: taskId,
      date: today,
      note: note[taskId] || undefined,
    });
    setNote({ ...note, [taskId]: '' });
  }

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-800">今日打卡</h1>
        <p className="text-sm text-gray-500 mt-1">{today} · 已完成 {todayCheckins.length} 项</p>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">
          家长还没有为你创建任务，请耐心等待～
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(tasksByDim.entries()).map(([dimId, dimTasks]) => {
            const dim = dimMap.get(dimId);
            return (
              <div key={dimId}>
                {dim && (
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: dim.color }}
                    />
                    <span className="text-sm font-medium text-gray-700">{dim.name}</span>
                  </div>
                )}
                <div className="space-y-2">
                  {dimTasks.map((t: any) => {
                    const checked = checkedTaskIds.has(t.id);
                    const effective = t.effective_points || Math.round((t.point_value || t.pointValue) * (t.difficulty_multiplier || t.difficultyMultiplier || 100) / 100);
                    return (
                      <div
                        key={t.id}
                        className={`bg-white rounded-xl p-3 shadow-sm ${checked ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-800">{t.title}</span>
                              <span className={`text-xs px-2 py-0.5 rounded ${DIFFICULTY_COLOR[t.difficulty]}`}>
                                {DIFFICULTY_LABEL[t.difficulty]}
                              </span>
                              <span className="text-xs text-brand-600 font-medium">+{effective} 积分</span>
                            </div>
                            {t.description && (
                              <div className="text-xs text-gray-500 mt-1">{t.description}</div>
                            )}
                          </div>
                          {checked ? (
                            <span className="text-green-500 text-sm flex items-center">
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              已完成
                            </span>
                          ) : (
                            <button
                              onClick={() => handleCheckin(t.id)}
                              disabled={createCheckinMut.isPending}
                              className="px-4 py-1.5 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:bg-brand-300"
                            >
                              打卡
                            </button>
                          )}
                        </div>
                        {!checked && (
                          <input
                            type="text"
                            placeholder="备注（可选）"
                            value={note[t.id] || ''}
                            onChange={(e) => setNote({ ...note, [t.id]: e.target.value })}
                            className="w-full mt-2 px-2 py-1 text-xs border rounded-lg"
                          />
                        )}
                        {createCheckinMut.isError && createCheckinMut.variables?.task_id === t.id && (
                          <div className="text-red-500 text-xs mt-1">
                            {(createCheckinMut.error as Error).message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
