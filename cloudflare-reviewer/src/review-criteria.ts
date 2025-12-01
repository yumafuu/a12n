import type { ReviewCriteria } from './types';

/**
 * KOS Assessment System (仮)
 * コードレビュー基準として参照するチェック項目
 * 実際の運用では外部ファイルやデータベースから読み込む想定
 */
export const REVIEW_CRITERIA: ReviewCriteria[] = [
  {
    category: 'セキュリティ',
    items: [
      {
        id: 'SEC-001',
        description: 'ハードコードされた認証情報やAPIキーが含まれていないか',
        severity: 'critical',
      },
      {
        id: 'SEC-002',
        description: 'SQLインジェクション対策が適切に実装されているか',
        severity: 'critical',
      },
      {
        id: 'SEC-003',
        description: 'XSS（クロスサイトスクリプティング）対策が実装されているか',
        severity: 'high',
      },
      {
        id: 'SEC-004',
        description: 'ユーザー入力の適切なバリデーションが行われているか',
        severity: 'high',
      },
    ],
  },
  {
    category: 'コーディング規約',
    items: [
      {
        id: 'CODE-001',
        description: '変数名・関数名が適切な命名規則に従っているか',
        severity: 'medium',
      },
      {
        id: 'CODE-002',
        description: 'コメントが適切に記述されているか（複雑なロジックには説明を追加）',
        severity: 'medium',
      },
      {
        id: 'CODE-003',
        description: '未使用のimport文や変数が削除されているか',
        severity: 'low',
      },
      {
        id: 'CODE-004',
        description: 'マジックナンバーを避け、定数として定義しているか',
        severity: 'medium',
      },
    ],
  },
  {
    category: 'パフォーマンス',
    items: [
      {
        id: 'PERF-001',
        description: '不要なループや再計算が含まれていないか',
        severity: 'medium',
      },
      {
        id: 'PERF-002',
        description: '大量データ処理時のメモリ効率が考慮されているか',
        severity: 'high',
      },
      {
        id: 'PERF-003',
        description: '非同期処理が適切に実装されているか',
        severity: 'medium',
      },
    ],
  },
  {
    category: 'エラーハンドリング',
    items: [
      {
        id: 'ERR-001',
        description: '例外が適切にキャッチ・ハンドリングされているか',
        severity: 'high',
      },
      {
        id: 'ERR-002',
        description: 'エラーメッセージが分かりやすく記述されているか',
        severity: 'medium',
      },
      {
        id: 'ERR-003',
        description: 'リソースの適切なクリーンアップが行われているか',
        severity: 'high',
      },
    ],
  },
  {
    category: 'テスタビリティ',
    items: [
      {
        id: 'TEST-001',
        description: '関数が単一責任原則に従っているか（テストしやすい設計）',
        severity: 'medium',
      },
      {
        id: 'TEST-002',
        description: '依存関係が適切に注入されているか',
        severity: 'medium',
      },
    ],
  },
];

/**
 * レビュー基準をテキスト形式で取得（Claude API へのプロンプトに含める用）
 */
export function getReviewCriteriaAsText(): string {
  let text = '# コードレビュー基準（KOS Assessment System）\n\n';

  for (const criteria of REVIEW_CRITERIA) {
    text += `## ${criteria.category}\n\n`;
    for (const item of criteria.items) {
      text += `- [${item.severity.toUpperCase()}] ${item.id}: ${item.description}\n`;
    }
    text += '\n';
  }

  return text;
}
