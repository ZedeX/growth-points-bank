import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

interface TaskForm {
  title: string;
  description: string;
  dimension_id: string;
  point_value: number;
  difficulty: 'easy' | 'medium' | 'hard';
  frequency: 'daily' | 'weekly';
  age_group: '6-8' | '9-11' | '12-14';
  is_active: boolean;
}

const EMPTY_FORM: TaskForm = {
  title: '',
  description: '',
  dimension_id: '',
  point_value: 10,
  difficulty: 'easy',
  frequency: 'daily',
  age_group: '6-8',
  is_active: true,
};

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [filterDim, setFilterDim] = useState<string>('');
  const [filterAge, setFilterAge] = useState<string>('');

  const { data: dimsData } = useQuery({
    queryKey: ['dimensions'],
    queryFn: () => api.getDimensions(),
  });
  const dimensions = dimsData?.dimensions || [];

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.getTasks(),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => api.createTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      closeForm();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      closeForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(task: any) {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description || '',
      dimension_id: task.dimension_id || task.dimensionId,
      point_value: task.point_value || task.pointValue,
      difficulty: task.difficulty,
      frequency: task.frequency,
      age_group: task.age_group || task.ageGroup,
      is_active: task.is_active ?? task.isActive ?? true,
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      ...form,
      point_value: Number(form.point_value),
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const dimMap = new Map(dimensions.map((d: any) => [d.id, d]));

  const tasks = (tasksData?.tasks || []).filter((t: any) => {
    if (filterDim && (t.dimension_id || t.dimensionId) !== filterDim) return false;
    if (filterAge && (t.age_group || t.ageGroup) !== filterAge) return false;
    return true;
  });

  const difficultyLabel = { easy: '简单', medium: '中等', hard: '困难' };
  const difficultyColor = { easy: 'bg-green-100 text-green-700', medium: 'bg-yellow-100 text-yellow-700', hard: 'bg-red-100 text-red-700' };

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">任务管理</h1>
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }}
          className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          + 新建任务
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <select
          value={filterDim}
          onChange={(e) => setFilterDim(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm bg-white"
        >
          <option value="">全部维度</option>
          {dimensions.map((d: any) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select
          value={filterAge}
          onChange={(e) => setFilterAge(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm bg-white"
        >
          <option value="">全部年龄</option>
          <option value="6-8">6-8 岁</option>
          <option value="9-11">9-11 岁</option>
          <option value="12-14">12-14 岁</option>
        </select>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-4 mb-4 space-y-3">
          <h3 className="font-medium">{editingId ? '编辑任务' : '新建任务'}</h3>
          <input
            type="text"
            placeholder="任务标题"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            maxLength={200}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <textarea
            placeholder="任务描述（可选）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={1000}
            rows={2}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.dimension_id}
              onChange={(e) => setForm({ ...form, dimension_id: e.target.value })}
              required
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">选择维度</option>
              {dimensions.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              value={form.age_group}
              onChange={(e) => setForm({ ...form, age_group: e.target.value as any })}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="6-8">6-8 岁</option>
              <option value="9-11">9-11 岁</option>
              <option value="12-14">12-14 岁</option>
            </select>
            <input
              type="number"
              min={1}
              max={100}
              placeholder="基础积分"
              value={form.point_value}
              onChange={(e) => setForm({ ...form, point_value: Number(e.target.value) })}
              className="px-3 py-2 border rounded-lg text-sm"
            />
            <select
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value as any })}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="easy">简单 (×1.0)</option>
              <option value="medium">中等 (×1.5)</option>
              <option value="hard">困难 (×2.0)</option>
            </select>
            <select
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value as any })}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="daily">每日任务</option>
              <option value="weekly">每周任务</option>
            </select>
            <label className="flex items-center px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="mr-2"
              />
              启用
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
              className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm hover:bg-brand-600 disabled:bg-brand-300"
            >
              {(createMut.isPending || updateMut.isPending) ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="flex-1 border border-gray-300 py-2 rounded-lg text-sm"
            >
              取消
            </button>
          </div>
          {(createMut.isError || updateMut.isError) && (
            <div className="text-red-500 text-sm">
              {((createMut.error || updateMut.error) as Error).message}
            </div>
          )}
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">暂无任务</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t: any) => {
            const dim = dimMap.get(t.dimension_id || t.dimensionId);
            const effective = t.effective_points || Math.round((t.point_value || t.pointValue) * (t.difficulty_multiplier || t.difficultyMultiplier || 100) / 100);
            return (
              <div key={t.id} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">{t.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${difficultyColor[t.difficulty as keyof typeof difficultyColor]}`}>
                        {difficultyLabel[t.difficulty as keyof typeof difficultyLabel]}
                      </span>
                      {dim && (
                        <span
                          className="text-xs px-2 py-0.5 rounded text-white"
                          style={{ backgroundColor: dim.color }}
                        >
                          {dim.name}
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">{t.description}</div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      {effective} 积分 · {t.frequency === 'daily' ? '每日' : '每周'} · {t.age_group || t.ageGroup} 岁
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => startEdit(t)}
                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('确认删除此任务？')) deleteMut.mutate(t.id);
                      }}
                      className="text-xs px-2 py-1 border border-red-300 text-red-500 rounded hover:bg-red-50"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
