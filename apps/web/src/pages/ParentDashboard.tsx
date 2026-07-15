import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

export default function ParentDashboard() {
  const queryClient = useQueryClient();
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChild, setNewChild] = useState({ name: '', age_group: '6-8' as '6-8' | '9-11' | '12-14', avatar: '' });
  const [tokenForChild, setTokenForChild] = useState<{ id: string; token: string } | null>(null);

  const { data: childrenData, isLoading: loadingChildren } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.getChildren(),
  });

  const { data: redemptionsData } = useQuery({
    queryKey: ['redemptions'],
    queryFn: () => api.getRedemptions(),
  });

  const createChildMut = useMutation({
    mutationFn: (data: { name: string; age_group: string; avatar?: string }) =>
      api.createChild(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
      setShowAddChild(false);
      setNewChild({ name: '', age_group: '6-8', avatar: '' });
    },
  });

  const regenerateTokenMut = useMutation({
    mutationFn: (id: string) => api.regenerateToken(id),
    onSuccess: (data: any, id: string) => {
      setTokenForChild({ id, token: data.accessToken });
    },
  });

  const pendingRedemptions = (redemptionsData?.redemptions || []).filter(
    (r: any) => r.status === 'pending'
  );

  async function copyLink(token: string) {
    const link = `${window.location.origin}/child/auth?token=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      alert('链接已复制：' + link);
    } catch {
      prompt('请手动复制：', link);
    }
  }

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">家庭看板</h1>
        <button
          onClick={() => setShowAddChild(true)}
          className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          + 添加孩子
        </button>
      </div>

      {showAddChild && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6 border border-brand-200">
          <h3 className="font-medium mb-3">新增孩子</h3>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="孩子姓名"
              value={newChild.name}
              onChange={(e) => setNewChild({ ...newChild, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
            <select
              value={newChild.age_group}
              onChange={(e) => setNewChild({ ...newChild, age_group: e.target.value as any })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="6-8">6-8 岁</option>
              <option value="9-11">9-11 岁</option>
              <option value="12-14">12-14 岁</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => createChildMut.mutate(newChild)}
                disabled={!newChild.name || createChildMut.isPending}
                className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm hover:bg-brand-600 disabled:bg-brand-300"
              >
                {createChildMut.isPending ? '创建中...' : '创建'}
              </button>
              <button
                onClick={() => setShowAddChild(false)}
                className="flex-1 border border-gray-300 py-2 rounded-lg text-sm"
              >
                取消
              </button>
            </div>
            {createChildMut.isError && (
              <div className="text-red-500 text-sm">
                {(createChildMut.error as Error).message}
              </div>
            )}
          </div>
        </div>
      )}

      {tokenForChild && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <h3 className="font-medium text-yellow-800 mb-2">孩子访问链接</h3>
          <p className="text-sm text-yellow-700 mb-2">
            请将以下链接发送给孩子（或扫码访问）。此链接 7 天内有效。
          </p>
          <div className="bg-white border rounded p-2 text-xs text-gray-600 break-all font-mono">
            {window.location.origin}/child/auth?token={tokenForChild.token}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => copyLink(tokenForChild.token)}
              className="px-3 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700"
            >
              复制链接
            </button>
            <button
              onClick={() => setTokenForChild(null)}
              className="px-3 py-1 border border-yellow-400 text-yellow-700 rounded text-xs"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {loadingChildren ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : (
        <div className="space-y-4">
          {(childrenData?.children || []).map((child: any) => (
            <div key={child.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-800">{child.name}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    年龄段：{child.age_group}
                  </div>
                </div>
                <button
                  onClick={() => regenerateTokenMut.mutate(child.id)}
                  disabled={regenerateTokenMut.isPending}
                  className="text-xs px-3 py-1 border border-brand-300 text-brand-600 rounded hover:bg-brand-50"
                >
                  生成访问链接
                </button>
              </div>
            </div>
          ))}
          {!loadingChildren && (childrenData?.children || []).length === 0 && (
            <div className="text-center py-12 text-gray-500">
              还没有孩子，点击右上角"添加孩子"开始
            </div>
          )}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">待处理兑换</h2>
        {pendingRedemptions.length === 0 ? (
          <div className="bg-white rounded-xl p-4 text-center text-gray-500 text-sm">
            暂无待处理兑换
          </div>
        ) : (
          <div className="space-y-2">
            {pendingRedemptions.map((r: any) => (
              <div key={r.id} className="bg-white rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{r.rewardTitle}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    消耗 {r.pointCost} 积分 · {new Date(r.redeemedAt).toLocaleString('zh-CN')}
                  </div>
                </div>
                <Link
                  to="/parent/rewards"
                  className="text-xs px-3 py-1 bg-brand-500 text-white rounded hover:bg-brand-600"
                >
                  去处理
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

