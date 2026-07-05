import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ============== 配置 ==============
const OBSIDIAN_ROOT = "/Users/mark.ma/Documents/obsidian/日常工作/马克莱莱综合待办";
const NOW = new Date();
const DATE_STR = NOW.toISOString().replace("T", " ").slice(0, 16); // YYYY-MM-DD HH:mm

// ============== 工具函数 ==============
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function appendToFile(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, content, "utf-8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatDate(date: Date = NOW): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildSummaryMd(text: string, source: string): string {
  return `

### ${formatDate()}

${text}

> 来源：${source}
`;
}

function buildTodoMd(text: string, category: string, source: string): string {
  return `

- [ ] ${text}（创建于 ${formatDate()}）
  > 分类：${category}
  > 来源：${source}
`;
}

function buildIdeaMd(text: string, source: string): string {
  return `

### ${formatDate()} 想法

${text}

> 来源：${source}
`;
}

function buildProgressMd(text: string, source: string): string {
  return `

## ${formatDate()} 进展

${text}

> 来源：${source}
`;
}

function buildMeetingMd(text: string, source: string): string {
  return `

## ${formatDate()}

${text}

> 来源：${source}
`;
}

function buildNoteMd(text: string, source: string): string {
  return `

### ${formatDate()} 备注

${text}

> 来源：${source}
`;
}

function buildScheduleMd(text: string, source: string): string {
  return `

- [ ] ${text}（创建于 ${formatDate()}）
  > 类型：日程
  > 来源：${source}
`;
}

// ============== 关键词匹配 ==============
type KeywordAction = "想法" | "待归档" | "待办" | "日程" | "进展" | "会议" | "备注" | "完成" | "任意内容";

interface MatchResult {
  action: KeywordAction;
  matchedText: string;
  restText?: string;
}

// 主题分类映射表（#主题 → 目录）
const THEME_CATEGORIES: Record<string, string> = {
  "#市场": "02-市场",
  "#产品": "03-产品",
  "#技术": "03-技术",
  "#售前": "01-售前",
  "#项目": "01-项目总览",
  "#项目管理": "01-项目总览",
  "#管理": "05-管理",
  "#个人": "06-个人",
  "#日程": "04-日程沉淀",
  "#会议": "04-日程沉淀",
  "#想法": "07-想法",
};

function matchKeyword(content: string): MatchResult | null {
  const text = content.trim();

  // 按优先级匹配
  const patterns: Array<{ keyword: string; action: KeywordAction }> = [
    { keyword: "#想法", action: "想法" },
    { keyword: "#任意内容", action: "待归档" },
    { keyword: "#待办", action: "待办" },
    { keyword: "#日程", action: "日程" },
    { keyword: "#进展", action: "进展" },
    { keyword: "#会议", action: "会议" },
    { keyword: "#备注", action: "备注" },
    { keyword: "#完成", action: "完成" },
    { keyword: "#todo", action: "待办" },
    { keyword: "待办", action: "待办" },
    { keyword: "日程", action: "日程" },
    { keyword: "进展", action: "进展" },
    { keyword: "会议", action: "会议" },
    { keyword: "备注", action: "备注" },
    { keyword: "完成", action: "完成" },
    { keyword: "done", action: "完成" },
    { keyword: "todo", action: "待办" },
    { keyword: "calendar", action: "日程" },
  ];

  for (const { keyword, action } of patterns) {
    if (text.includes(keyword)) {
      const idx = text.indexOf(keyword);
      const before = text.slice(0, idx).trim();
      const after = text.slice(idx + keyword.length).trim();
      return {
        action,
        matchedText: before ? `${before} ${after}`.trim() : after || text,
        restText: before || undefined,
      };
    }
  }

  // 检查 #主题分类（如 #市场、#产品）
  for (const [theme, dir] of Object.entries(THEME_CATEGORIES)) {
    if (text.startsWith(theme)) {
      const rest = text.slice(theme.length).trim();
      // 如果 #主题 后面有具体内容 → 按主题分类
      if (rest) {
        return {
          action: "待办",
          matchedText: rest,
          restText: theme,
        };
      }
      // 如果 #主题 后面无内容 → 归档
      return {
        action: "待归档",
        matchedText: text,
      };
    }
  }

  // 任意 #xxx 主题（未在映射表中）→ 自动创建 08-xxx/ 目录
  const customThemeMatch = text.match(/^#([^\s#]+)\s*(.*)$/);
  if (customThemeMatch) {
    const theme = customThemeMatch[1];
    const rest = customThemeMatch[2].trim();
    if (rest) {
      return {
        action: "待办",
        matchedText: rest,
        restText: `#${theme}`,
      };
    }
    // #主题 后无内容 → 归档
    return {
      action: "待归档",
      matchedText: text,
    };
  }

  // 其他任意消息 → 归档
  return {
    action: "待归档",
    matchedText: text,
  };
}

// ============== 目录扫描（用于分类匹配）==============
async function getCategories(): Promise<string[]> {
  try {
    const entries = await fs.readdir(OBSIDIAN_ROOT, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
}

async function findProjectFile(text: string): Promise<string | null> {
  try {
    const categories = await getCategories();
    const lowerText = text.toLowerCase();

    for (const cat of categories) {
      const catPath = path.join(OBSIDIAN_ROOT, cat);
      const files = await fs.readdir(catPath);
      const mdFiles = files.filter((f) => f.endsWith(".md") && f !== "待办.md");

      for (const file of mdFiles) {
        const fileName = file.replace(".md", "").toLowerCase();
        if (lowerText.includes(fileName) || fileName.includes(lowerText)) {
          return path.join(catPath, file);
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ============== 汇总待办写入 ==============
async function appendToSummary(todoContent: string) {
  const summaryPath = path.join(OBSIDIAN_ROOT, "汇总待办.md");
  const exists = await fileExists(summaryPath);
  if (!exists) {
    await fs.writeFile(summaryPath, "# 汇总待办\n\n", "utf-8");
  }
  await fs.appendFile(summaryPath, todoContent, "utf-8");
}

// ============== 主处理 ==============
async function processMessage(content: string, source: string): Promise<void> {
  const match = matchKeyword(content);
  if (!match) return;

  const { action, matchedText } = match;

  switch (action) {
    case "想法": {
      const filePath = path.join(OBSIDIAN_ROOT, "07-想法/想法.md");
      await appendToFile(filePath, buildIdeaMd(matchedText, source));
      console.log(`[obsidian-todo-hook] 写入想法到 ${filePath}`);
      break;
    }

    case "待归档": {
      const filePath = path.join(OBSIDIAN_ROOT, "00-待归档/待归档.md");
      await appendToFile(filePath, buildSummaryMd(matchedText, source));
      console.log(`[obsidian-todo-hook] 写入待归档到 ${filePath}`);
      break;
    }

    case "待办": {
      // 扫描目录确定分类
      const categories = await getCategories();
      let category = "00-收集箱";
      let targetPath: string;

      // 优先匹配 #主题分类（来自 restText）
      if (match.restText && THEME_CATEGORIES[match.restText]) {
        category = THEME_CATEGORIES[match.restText];
      } else if (match.restText && match.restText.startsWith("#")) {
        // 自定义主题（如 #测试）→ 自动创建 08-xxx/ 目录
        const themeName = match.restText.slice(1);
        category = `08-${themeName}`;
      } else {
        // 否则扫描目录尝试匹配
        for (const cat of categories) {
          if (matchedText.toLowerCase().includes(cat.replace(/^\d+-/, "").toLowerCase())) {
            category = cat;
            break;
          }
        }
      }

      // 自动创建缺失的分类目录
      await ensureDir(path.join(OBSIDIAN_ROOT, category));

      targetPath = path.join(OBSIDIAN_ROOT, category, "待办.md");
      await appendToFile(targetPath, buildTodoMd(matchedText, category, source));
      await appendToSummary(buildTodoMd(matchedText, category, source));
      console.log(`[obsidian-todo-hook] 写入待办到 ${targetPath}`);
      break;
    }

    case "日程": {
      const filePath = path.join(OBSIDIAN_ROOT, "04-日程沉淀/日程.md");
      await appendToFile(filePath, buildScheduleMd(matchedText, source));
      await appendToSummary(buildScheduleMd(matchedText, source));
      console.log(`[obsidian-todo-hook] 写入日程到 ${filePath}`);
      break;
    }

    case "进展": {
      const projectFile = await findProjectFile(matchedText);
      const filePath = projectFile || path.join(OBSIDIAN_ROOT, "00-收集箱/进展.md");
      await appendToFile(filePath, buildProgressMd(matchedText, source));
      console.log(`[obsidian-todo-hook] 写入进展到 ${filePath}`);
      break;
    }

    case "会议": {
      const filePath = path.join(OBSIDIAN_ROOT, "04-日程沉淀/会议纪要.md");
      await appendToFile(filePath, buildMeetingMd(matchedText, source));
      console.log(`[obsidian-todo-hook] 写入会议纪要到 ${filePath}`);
      break;
    }

    case "备注": {
      const projectFile = await findProjectFile(matchedText);
      const filePath = projectFile || path.join(OBSIDIAN_ROOT, "00-收集箱/备注.md");
      await appendToFile(filePath, buildNoteMd(matchedText, source));
      console.log(`[obsidian-todo-hook] 写入备注到 ${filePath}`);
      break;
    }

    case "完成": {
      // 查找并标记完成（简化版：仅追加完成记录到收集箱）
      const donePath = path.join(OBSIDIAN_ROOT, "00-收集箱/已完成记录.md");
      await appendToFile(donePath, `\n- [x] ${matchedText}（完成于 ${formatDate()}）\n  > 来源：${source}\n`);
      console.log(`[obsidian-todo-hook] 记录完成到 ${donePath}`);
      break;
    }

    case "任意内容": {
      const filePath = path.join(OBSIDIAN_ROOT, "00-待归档/待归档.md");
      await appendToFile(filePath, buildSummaryMd(matchedText, source));
      console.log(`[obsidian-todo-hook] 任意内容归档到 ${filePath}`);
      break;
    }
  }
}

// ============== Hook Handler ==============
interface MessageEvent {
  type: string;
  action: string;
  sessionKey: string;
  timestamp: number;
  context: {
    from: string;
    content: string;
    channelId: string;
    metadata: {
      senderId?: string;
      senderName?: string;
      chat_id?: string;
    };
  };
}

const handler = async (event: MessageEvent) => {
  // 只处理飞书消息
  if (!event.context?.channelId) return;
  if (event.type !== "message" || event.action !== "received") return;

  const content = event.context.content || "";
  const sender = event.context.metadata?.senderName || event.context.from || "飞书对话";
  const source = `飞书 / ${sender}`;

  try {
    await processMessage(content, source);
  } catch (err) {
    console.error("[obsidian-todo-hook] 处理失败:", err);
  }
};

export default handler;
