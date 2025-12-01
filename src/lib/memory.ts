import * as fs from "fs/promises";
import * as path from "path";

// メモリディレクトリのパス
const MEMORY_DIR = ".aio/memory";

// 利用可能なカテゴリ
export enum MemoryCategory {
  ARCHITECTURE = "architecture",
  TECH_STACK = "tech-stack",
  REQUIREMENTS = "requirements",
  DECISIONS = "decisions",
  CONVENTIONS = "conventions",
}

/**
 * メモリファイルのパスを取得
 */
function getMemoryFilePath(
  category: MemoryCategory,
  projectRoot?: string
): string {
  const root = projectRoot || process.cwd();
  return path.join(root, MEMORY_DIR, `${category}.md`);
}

/**
 * メモリディレクトリが存在するか確認し、なければ作成
 */
async function ensureMemoryDir(projectRoot?: string): Promise<void> {
  const root = projectRoot || process.cwd();
  const memoryDir = path.join(root, MEMORY_DIR);

  try {
    await fs.access(memoryDir);
  } catch {
    await fs.mkdir(memoryDir, { recursive: true });
  }
}

/**
 * 特定のカテゴリのメモリを読み込む
 */
export async function readMemory(
  category: MemoryCategory,
  projectRoot?: string
): Promise<string> {
  const filePath = getMemoryFilePath(category, projectRoot);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch (error) {
    // ファイルが存在しない場合は空文字を返す
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

/**
 * 特定のカテゴリのメモリを上書き保存
 */
export async function writeMemory(
  category: MemoryCategory,
  content: string,
  projectRoot?: string
): Promise<void> {
  await ensureMemoryDir(projectRoot);
  const filePath = getMemoryFilePath(category, projectRoot);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * 特定のカテゴリのメモリに内容を追記
 */
export async function appendMemory(
  category: MemoryCategory,
  content: string,
  projectRoot?: string
): Promise<void> {
  await ensureMemoryDir(projectRoot);
  const filePath = getMemoryFilePath(category, projectRoot);

  // 既存の内容を読み込む
  const existingContent = await readMemory(category, projectRoot);

  // 改行で区切って追記
  const newContent = existingContent
    ? `${existingContent}\n\n${content}`
    : content;

  await fs.writeFile(filePath, newContent, "utf-8");
}

/**
 * 全てのメモリカテゴリを読み込む
 */
export async function readAllMemories(
  projectRoot?: string
): Promise<Record<MemoryCategory, string>> {
  const result: Record<string, string> = {};

  for (const category of Object.values(MemoryCategory)) {
    result[category] = await readMemory(category as MemoryCategory, projectRoot);
  }

  return result as Record<MemoryCategory, string>;
}

/**
 * メモリが存在するか確認
 */
export async function hasMemory(
  category: MemoryCategory,
  projectRoot?: string
): Promise<boolean> {
  const filePath = getMemoryFilePath(category, projectRoot);

  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, "utf-8");
    return content.trim().length > 0;
  } catch {
    return false;
  }
}
