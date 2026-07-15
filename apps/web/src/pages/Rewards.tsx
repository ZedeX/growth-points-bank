import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

interface RewardForm {
  title: string;
  description: string;
  point_cost: number;
  total_inventory: number;
  weekly_limit_per_child: number;
  icon: string;
}

const EMPTY_FORM: RewardForm = {
  title: '',
  description: '',
  point_cost: 50,
  total_inventory: 999,
  weekly_limit_per_child: 1,
  icon: '',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  fulfilled: '已兑现',
  cancelled: '已取消',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
  fulfilled: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

export default function RewardsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RewardForm>(EMPTY_FORM);
  const [tab, setTab] = useState<'rewards' | 'redemptions'>('rewards');

  const { data: rewardsData, isLoading } = useQuery({
    queryKey: ['rewards'],
    queryFn: () => api.getRewards(),
  });

  const { data: redemptionsData } = useQuery({
    queryKey: ['redemptions'],
    queryFn: () => api.getRedemptions(),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => api.createReward(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rewards'] });
      closeForm();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateReward(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rewards'] });
      closeForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteReward(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rewards'] }),
  });

  const updateRedemptionMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateRedemption(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['redemptions'] }),
  });

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(r: any) {
    setEditingId(r.id);
    setForm({
      title: r.title,
      description: r.description || '',
      point_cost: r.point_cost || r.pointCost,
      total_inventory: r.total_inventory || r.totalInventory,
      weekly_limit_per_child: r.weekly_limit_per_child || r.weeklyLimitPerChild,
      icon: r.icon || '',
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      ...form,
      point_cost: Number(form.point_cost),
      total_inventory: Number(form.total_inventory),
      weekly_limit_per_child: Number(form.weekly_limit_per_child),
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const rewards = rewardsData?.rewards || [];
  const redemptions = redemptionsData?.redemptions || [];

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">奖励管理</h1>
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }}
          className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          + 新建奖励
        </button>
      </div>

      <div className="flex border-b mb-4">
        <button
          onClick={() => setTab('rewards')}
          className={`px-4 py-2 text-sm ${tab === 'rewards' ? 'border-b-2 border-brand-500 text-brand-600 font-medium' : 'text-gray-500'}`}
        >
          奖励列表 ({rewards.length})
        </button>
        <button
          onClick={() => setTab('redemptions')}
          className={`px-4 py-2 text-sm ${tab === 'redemptions' ? 'border-b-2 border-brand-500 text-brand-600 font-medium' : 'text-gray-500'}`}
        >
          兑换记录 ({redemptions.length})
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-4 mb-4 space-y-3">
          <h3 className="font-medium">{editingId ? '编辑奖励' : '新建奖励'}</h3>
          <input
            type="text"
            placeholder="奖励标题"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            maxLength={200}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <textarea
            placeholder="奖励描述"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">兑换所需积分</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={form.point_cost}
                onChange={(e) => setForm({ ...form, point_cost: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">总库存</label>
              <input
                type="number"
                min={1}
                value={form.total_inventory}
                onChange={(e) => setForm({ ...form, total_inventory: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">每人每周限兑</label>
              <input
                type="number"
                min={0}
                value={form.weekly_limit_per_child}
                onChange={(e) => setForm({ ...form, weekly_limit_per_child: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">图标（可选）</label>
              <input
                type="text"
                placeholder="emoji 或 url"
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
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
        </form>
      )}

      {tab === 'rewards' ? (
        isLoading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : rewards.length === 0 ? (
          <div className="text-center py-12 text-gray-500">暂无奖励</div>
        ) : (
          <div className="space-y-2">
            {rewards.map((r: any) => {
              const claimed = r.total_claimed ?? r.totalClaimed ?? 0;
              const total = r.total_inventory ?? r.totalInventory ?? 999;
              const cost = r.point_cost ?? r.pointCost;
              return (
                <div key={r.id} className="bg-white rounded-xl p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {r.icon && <span className="text-xl">{r.icon}</span>}
                        <span className="font-medium text-gray-800">{r.title}</span>
                      </div>
                      {r.description && (
                        <div className="text-xs text-gray-500 mt-1">{r.description}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-1">
                        {cost} 积分 · 库存 {claimed}/{total}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => startEdit(r)}
                        className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('确认删除此奖励？')) deleteMut.mutate(r.id);
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
        )
      ) : (
        <div className="space-y-2">
          {redemptions.length === 0 ? (
            <div className="text-center py-12 text-gray-500">暂无兑换记录</div>
          ) : (
            redemptions.map((r: any) => (
              <div key={r.id} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {r.rewardIcon && <span>{r.rewardIcon}</span>}
                      <span className="font-medium text-gray-800">{r.rewardTitle}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      消耗 {r.pointCost} 积分 · {new Date(r.redeemedAt).toLocaleString('zh-CN')}
                    </div>
                    {r.parentNote && (
                      <div className="text-xs text-gray-500 mt-1">家长备注：{r.parentNote}</div>
                    )}
                  </div>
                  {r.status === 'pending' && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => updateRedemptionMut.mutate({ id: r.id, data: { status: 'approved' } })}
                        className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        批准
                      </button>
                      <button
                        onClick={() => updateRedemptionMut.mutate({ id: r.id, data: { status: 'rejected' } })}
                        className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        拒绝
                      </button>
                    </div>
                  )}
                  {r.status === 'approved' && (
                    <button
                      onClick={() => updateRedemptionMut.mutate({ id: r.id, data: { status: 'fulfilled' } })}
                      className="text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      标记已兑现
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
