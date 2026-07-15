import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client.js';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    family_name: '',
    parent_name: '',
    email: '',
    phone: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.email && !form.phone) {
      setError('请填写邮箱或手机号');
      return;
    }
    if (form.password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (!/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setError('密码需包含大写字母、小写字母和数字');
      return;
    }

    setLoading(true);
    try {
      const result = await api.register({
        family_name: form.family_name,
        parent_name: form.parent_name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        password: form.password,
      });
      setToken(result.token);
      navigate('/parent/dashboard');
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-gradient-to-br from-brand-50 to-brand-100">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-brand-600">注册家庭账号</h1>
          <p className="text-gray-500 mt-1 text-sm">开启孩子的成长积分之旅</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">家庭名称</label>
            <input
              type="text"
              value={form.family_name}
              onChange={(e) => update('family_name', e.target.value)}
              required
              maxLength={100}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder="例如：张家"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">家长姓名</label>
            <input
              type="text"
              value={form.parent_name}
              onChange={(e) => update('parent_name', e.target.value)}
              required
              maxLength={100}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder="例如：张爸爸"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱（二选一）</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder="example@mail.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">手机号（二选一）</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder="13800138000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              required
              minLength={8}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder="至少 8 位，含大小写字母和数字"
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-medium py-2.5 rounded-lg transition"
          >
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <div className="text-center mt-4 text-sm text-gray-500">
          已有账号？<Link to="/login" className="text-brand-600 hover:underline">直接登录</Link>
        </div>
      </div>
    </div>
  );
}
