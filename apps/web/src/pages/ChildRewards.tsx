import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

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

export default function ChildRewards() {
  const queryClient = useQueryClient();

  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: () => api.getBalance(),
  });

  const { data: rewardsData, isLoading } = useQuery({
    queryKey: ['rewards'],
    queryFn: () => api.getRewards(),
  });

  const { data: redemptionsData } = useQuery({
    queryKey: ['redemptions'],
    queryFn: () => api.getRedemptions(),
  });

  const redeemMut = useMutation({
    mutationFn: (rewardId: string) => api.createRedemption(rewardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['redemptions'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
    },
  });

  const balance = balanceData?.balance ?? 0;
  const rewards = rewardsData?.rewards || [];
  const redemptions = redemptionsData?.redemptions || [];

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">奖励兑换</h1>
        <div className="bg-brand-100 text-brand-700 px-3 py-1.5 rounded-lg text-sm font-medium">
          余额：{balance}
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-800 mb-3">可兑换奖励</h2>
      {isLoading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : rewards.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">
          家长还没有创建奖励，请耐心等待～
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-8">
          {rewards.map((r: any) => {
            const claimed = r.total_claimed ?? r.totalClaimed ?? 0;
            const total = r.total_inventory ?? r.totalInventory ?? 999;
            const cost = r.point_cost ?? r.pointCost;
            const affordable = balance >= cost;
            const inStock = claimed < total;
            return (
              <div key={r.id} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="text-3xl mb-2">{r.icon || '🎁'}</div>
                <div className="font-medium text-gray-800 text-sm">{r.title}</div>
                {r.description && (
                  <div className="text-xs text-gray-500 mt-1 line-clamp-2">{r.description}</div>
                )}
                <div className="text-brand-600 font-bold mt-2">{cost} 积分</div>
                <div className="text-xs text-gray-400 mt-1">库存 {claimed}/{total}</div>
                <button
                  onClick={() => redeemMut.mutate(r.id)}
                  disabled={!affordable || !inStock || redeemMut.isPending}
                  className="w-full mt-3 py-1.5 rounded-lg text-sm font-medium disabled:bg-gray-200 disabled:text-gray-400 bg-brand-500 text-white hover:bg-brand-600"
                >
                  {!inStock ? '已抢完' : !affordable ? '积分不足' : '兑换'}
                </button>
                {redeemMut.isError && redeemMut.variables === r.id && (
                  <div className="text-red-500 text-xs mt-1">
                    {(redeemMut.error as Error).message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-800 mb-3">我的兑换记录</h2>
      {redemptions.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center text-gray-500 text-sm">
          暂无兑换记录
        </div>
      ) : (
        <div className="space-y-2">
          {redemptions.map((r: any) => (
            <div key={r.id} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {r.rewardIcon && <span>{r.rewardIcon}</span>}
                  <span className="font-medium text-sm">{r.rewardTitle}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  -{r.pointCost} 积分 · {new Date(r.redeemedAt).toLocaleString('zh-CN')}
                </div>
                {r.parentNote && (
                  <div className="text-xs text-gray-500 mt-1">家长备注：{r.parentNote}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
