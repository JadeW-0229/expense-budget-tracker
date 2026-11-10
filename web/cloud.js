import { createClient } from '@supabase/supabase-js';

export class ExpenseCloud {
  constructor(client, { anonymousClient = null, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.client = client;
    this.anonymousClient = anonymousClient;
    this.wait = wait;
    this.version = null;
    this.canAdmin = false;
    this.current = null;
    this.updatedAt = null;
    this.lastSuccess = 0;
    this.reading = null;
  }
  accept(payload) {
    if (!payload || !Number.isSafeInteger(payload.version) || !payload.state ||
        !Array.isArray(payload.state.records) || !Array.isArray(payload.state.budgets)) {
      throw new Error('雲端資料格式不正確，未載入本機舊帳本。');
    }
    // A slower poll must not replace a newer successful commit response.
    if (this.version !== null && payload.version < this.version) return structuredClone(this.current);
    this.version = payload.version;
    this.canAdmin = payload.canAdmin === true;
    this.updatedAt = payload.updatedAt || this.updatedAt;
    this.lastSuccess = Date.now();
    this.catalog = payload.catalog;
    this.current = structuredClone(payload.state);
    return structuredClone(this.current);
  }
  isAuthError(error) {
    return /JWT|refresh.token|token.*expired|invalid.*token/i.test(String(error?.message || '')) ||
      ['PGRST301', 'PGRST302', 'PGRST303', 'bad_jwt', 'refresh_token_not_found'].includes(error?.code) || error?.status === 401;
  }
  isTransient(error) {
    return [0, 408, 429, 502, 503, 504].includes(error?.status) ||
      /fetch|network|timeout|timed out|abort|連線逾時/i.test(String(error?.message || ''));
  }
  async deadline(promise) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('連線逾時'), { status: 0 })), 16000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async rpc(client, name, args) {
    try { return await this.deadline(client.rpc(name, args)); }
    catch (error) { return { data: null, error }; }
  }
  async repairSession() {
    try {
      const refreshed = await this.deadline(this.client.auth.refreshSession());
      if (!refreshed.error && refreshed.data?.session) return true;
    } catch {}
    this.canAdmin = false;
    try { await this.deadline(this.client.auth.signOut({ scope: 'local' })); } catch {}
    return false;
  }
  read() {
    if (this.reading) return this.reading;
    this.reading = this.performRead().finally(() => { this.reading = null; });
    return this.reading;
  }
  async performRead() {
    let client = this.client, repaired = false, response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await this.rpc(client, 'expense_snapshot');
      if (!response.error) return this.accept(response.data);
      if (this.isAuthError(response.error) && !repaired) {
        repaired = true;
        if (!await this.repairSession()) {
          if (!this.anonymousClient) throw this.translate(response.error);
          client = this.anonymousClient;
        }
        continue;
      }
      if (!this.isTransient(response.error) || attempt === 2) break;
      await this.wait(300 * (attempt + 1));
    }
    throw this.translate(response.error);
  }
  async commit(state) {
    if (!this.canAdmin) throw new Error('需要管理者登入才能儲存。');
    const parameters = {
      p_version: this.version,
      p_request_id: crypto.randomUUID(),
      p_state: {
        records: state.records,
        budgets: state.budgets,
        startDates: state.startDates,
        deletedRecords: state.deletedRecords || []
      }
    };
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await this.rpc(this.client, 'expense_commit', parameters);
      if (!response.error) return this.accept(response.data);
      if (this.isAuthError(response.error)) {
        if (attempt === 0 && await this.repairSession()) continue;
        this.canAdmin = false;
        throw this.translate({ message: 'ADMIN_REQUIRED' });
      }
      // Same request UUID on retry: a committed-but-lost response cannot duplicate a write.
      if (!this.isTransient(response.error) || attempt === 1) break;
      await this.wait(350);
    }
    if (this.isTransient(response.error)) {
      const status = await this.rpc(this.client, 'expense_request_status', { p_request_id: parameters.p_request_id });
      if (!status.error && status.data?.committed) return this.accept(status.data.snapshot);
      throw Object.assign(new Error('無法確認儲存結果。請重新連線查看明細，確認前不要重複新增。'), { code: 'UNCERTAIN_COMMIT' });
    }
    throw this.translate(response.error);
  }
  translate(error) {
    const message = String(error?.message || '');
    const messages = {
      VERSION_CONFLICT: '另一位管理者已更新帳本，本次未儲存。請重新整理後再操作。',
      BUDGET_EXCEEDED: '超出該組別、該科目的預算，本次支出未儲存。',
      ADMIN_REQUIRED: '管理權限已失效，本次未儲存，請重新登入。',
      LEDGER_NOT_INITIALIZED: '雲端帳本尚未匯入，請先完成資料初始化。'
    };
    for (const [code, text] of Object.entries(messages)) if (message.includes(code)) {
      return Object.assign(new Error(text), { code, details: error.details });
    }
    return new Error('雲端連線或資料驗證失敗，本次未儲存。請確認網路並重新整理。');
  }
  async login(account, password) {
    const config = window.APP_CONFIG;
    const email = account === config.adminLoginAlias ? config.adminLoginEmail : account;
    if (!email || !email.includes('@')) throw new Error('請輸入管理者電子郵件，或先設定管理者帳號對應。');
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error('帳號或密碼不正確，或尚未啟用此管理者。');
    await this.read();
    if (!this.canAdmin) {
      await this.client.auth.signOut();
      throw new Error('此帳號尚未取得經費管理權限。');
    }
    return this.current;
  }
  async logout() {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error('登出未完成，請確認網路後重試。');
    this.canAdmin = false;
  }
}

export async function connectCloud() {
  const c = window.APP_CONFIG;
  if (!c || !c.publishableKey || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(c.supabaseUrl)) {
    throw new Error('正式版尚未設定完成。請設定 Supabase 公開 API 金鑰並匯入帳本。');
  }
  if (c.publishableKey.startsWith('sb_secret_')) throw new Error('前端禁止使用秘密 API 金鑰。');
  if (c.publishableKey.includes('.')) {
    try {
      const claims = JSON.parse(atob(c.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (claims.role === 'service_role') throw new Error('SECRET_KEY');
    } catch (e) {
      if (e.message === 'SECRET_KEY') throw new Error('前端禁止使用 service_role 金鑰。');
    }
  }
  const safeFetch = async (input, options = {}) => {
    const timeout = AbortSignal.timeout(12000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return fetch(input, { ...options, signal, cache: 'no-store' });
  };
  const client = createClient(c.supabaseUrl, c.publishableKey, {
    global: { fetch: safeFetch },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, lockAcquireTimeout: 10000 }
  });
  const anonymousClient = createClient(c.supabaseUrl, c.publishableKey, {
    global: { fetch: safeFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const cloud = new ExpenseCloud(client, { anonymousClient });
  try { await cloud.deadline(client.auth.getSession()); } catch {}
  await cloud.read();
  return cloud;
}
