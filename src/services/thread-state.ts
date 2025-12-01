/**
 * スレッド状態管理サービス
 * Slack スレッドと GitHub Issue の紐付けと会話履歴を管理
 */

export interface ThreadState {
  issueNumber: number;
  repoOwner: string;
  repoName: string;
  issueUrl: string;
  issueTitle: string;
  originalQuestion: string;
  conversationHistory: Array<{ role: string; content: string }>;
  lastDraftAnswer: string;
}

export class ThreadStateService {
  // メモリ内でスレッド状態を管理
  // key: thread_ts (Slack のスレッド識別子)
  private states: Map<string, ThreadState> = new Map();

  /**
   * スレッド状態を保存
   */
  saveThreadState(threadTs: string, state: ThreadState): void {
    this.states.set(threadTs, state);
  }

  /**
   * スレッド状態を取得
   */
  getThreadState(threadTs: string): ThreadState | undefined {
    return this.states.get(threadTs);
  }

  /**
   * スレッドの会話履歴を追加
   */
  addConversationHistory(
    threadTs: string,
    role: string,
    content: string
  ): void {
    const state = this.states.get(threadTs);
    if (!state) {
      throw new Error(`Thread state not found for ${threadTs}`);
    }

    state.conversationHistory.push({ role, content });
    this.states.set(threadTs, state);
  }

  /**
   * 最新の回答ドラフトを更新
   */
  updateLastDraftAnswer(threadTs: string, answer: string): void {
    const state = this.states.get(threadTs);
    if (!state) {
      throw new Error(`Thread state not found for ${threadTs}`);
    }

    state.lastDraftAnswer = answer;
    this.states.set(threadTs, state);
  }

  /**
   * スレッド状態が存在するかチェック
   */
  hasThreadState(threadTs: string): boolean {
    return this.states.has(threadTs);
  }

  /**
   * すべてのスレッド状態をクリア（テスト用）
   */
  clear(): void {
    this.states.clear();
  }
}
