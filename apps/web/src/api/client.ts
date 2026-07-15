const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('parent_token') || null;
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem('parent_token', token);
  } else {
    localStorage.removeItem('parent_token');
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: 'Request failed' } }));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: any) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  // Auth
  login: (email_or_phone: string, password: string) =>
    api.post<{ token: string; parent: any }>('/auth/login', { email_or_phone, password }),
  register: (data: any) =>
    api.post<{ token: string; family: any; parent: any }>('/auth/register', data),

  // Children
  getChildren: () => api.get<{ children: any[] }>('/children'),
  createChild: (data: any) => api.post('/children', data),
  regenerateToken: (id: string) => api.post<{ accessToken: string }>(`/children/${id}/regenerate-token`),

  // Tasks
  getTasks: () => api.get<{ tasks: any[] }>('/tasks'),
  createTask: (data: any) => api.post('/tasks', data),
  updateTask: (id: string, data: any) => api.patch(`/tasks/${id}`, data),
  deleteTask: (id: string) => api.delete(`/tasks/${id}`),

  // Dimensions
  getDimensions: () => api.get<{ dimensions: any[] }>('/dimensions'),

  // Check-ins
  createCheckin: (data: any) => api.post('/checkins', data),
  getCheckins: (childId?: string) => api.get<{ checkins: any[] }>(`/checkins${childId ? `?child_id=${childId}` : ''}`),

  // Points
  getBalance: (childId?: string) => api.get<{ balance: number }>(`/points/balance${childId ? `?child_id=${childId}` : ''}`),
  getHistory: (childId?: string) => api.get<{ history: any[] }>(`/points/history${childId ? `?child_id=${childId}` : ''}`),

  // Rewards
  getRewards: () => api.get<{ rewards: any[] }>('/rewards'),
  createReward: (data: any) => api.post('/rewards', data),
  updateReward: (id: string, data: any) => api.patch(`/rewards/${id}`, data),
  deleteReward: (id: string) => api.delete(`/rewards/${id}`),

  // Redemptions
  getRedemptions: (childId?: string) => api.get<{ redemptions: any[] }>(`/redemptions${childId ? `?child_id=${childId}` : ''}`),
  createRedemption: (rewardId: string) => api.post('/redemptions', { reward_id: rewardId }),
  updateRedemption: (id: string, data: any) => api.patch(`/redemptions/${id}`, data),

  // Reviews
  getReview: (childId: string, weekStart: string) => api.get(`/reviews?child_id=${childId}&week_start_date=${weekStart}`),
  submitChildReview: (data: any) => api.post('/reviews/child', data),
  submitParentReview: (data: any) => api.post('/reviews/parent', data),

  // Diaries
  getDiaries: (childId?: string) => api.get<{ diaries: any[] }>(`/diaries${childId ? `?child_id=${childId}` : ''}`),
  createDiary: (data: any) => api.post('/diaries', data),
  updateDiary: (id: string, data: any) => api.patch(`/diaries/${id}`, data),
  deleteDiary: (id: string) => api.delete(`/diaries/${id}`),
};
