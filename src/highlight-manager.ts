import { App, TFile, MarkdownView, editorLivePreviewField } from "obsidian";
import type ChineseWriterPlugin from "./main";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, PluginValue } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/**
 * 高亮管理器
 * 负责在编辑器中高亮显示设定库中的关键字
 */
export class HighlightManager {
  plugin: ChineseWriterPlugin;
  app: App;
  private keywordsCache: Map<string, Set<string>> = new Map();

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  /**
   * 获取当前文件对应的设定库路径
   */
  getSettingFolderForFile(filePath: string): string | null {
    console.log("检查文件路径:", filePath);
    console.log("当前对应关系:", this.plugin.settings.folderMappings);

    // 检查文件是否在某个小说库中
    for (const mapping of this.plugin.settings.folderMappings) {
      if (mapping.novelFolder && mapping.settingFolder) {
        // 标准化路径，确保没有前导/后缀斜杠
        const normalizedNovelFolder = mapping.novelFolder.replace(/^\/+|\/+$/g, '');
        const normalizedFilePath = filePath.replace(/^\/+/, '');

        console.log("检查映射:", normalizedNovelFolder, "->", mapping.settingFolder);
        console.log("文件路径是否匹配:", normalizedFilePath.startsWith(normalizedNovelFolder + "/"));

        if (normalizedFilePath.startsWith(normalizedNovelFolder + "/")) {
          console.log("找到匹配的设定库:", mapping.settingFolder);
          return mapping.settingFolder;
        }
      }
    }

    console.log("未找到匹配的设定库");
    return null;
  }

  /**
   * 从设定库中提取所有H2标题（关键字）
   */
  async extractKeywordsFromSettingFolder(settingFolder: string): Promise<Set<string>> {
    // 检查缓存
    if (this.keywordsCache.has(settingFolder)) {
      return this.keywordsCache.get(settingFolder)!;
    }

    const keywords = new Set<string>();

    if (!settingFolder) {
      return keywords;
    }

    // 获取设定库中的所有文件
    const files = this.plugin.parser.getMarkdownFilesInFolder(settingFolder);

    // 解析每个文件，提取H2标题
    for (const file of files) {
      const parseResult = await this.plugin.parser.parseFile(file);
      if (parseResult) {
        // 遍历所有H1
        for (const h1 of parseResult.h1List) {
          // 遍历所有H2
          for (const h2 of h1.h2List) {
            // H2的文本就是关键字
            if (h2.text.trim()) {
              keywords.add(h2.text.trim());
            }
          }
        }
      }
    }

    // 缓存结果
    this.keywordsCache.set(settingFolder, keywords);

    return keywords;
  }

  /**
   * 清除关键字缓存
   */
  clearCache(): void {
    this.keywordsCache.clear();
  }

  /**
   * 创建编辑器扩展
   */
  createEditorExtension() {
    const manager = this;

    return ViewPlugin.fromClass(
      class implements PluginValue {
        decorations: DecorationSet = Decoration.none;
        currentFile: TFile | null = null;

        constructor(view: EditorView) {
          this.updateDecorations(view);
        }

        async updateDecorations(view: EditorView) {
          // 获取当前活动的 Markdown 视图
          const activeView = manager.app.workspace.getActiveViewOfType(MarkdownView);
          if (!activeView || !activeView.file) {
            this.decorations = Decoration.none;
            return;
          }

          const file = activeView.file;
          this.currentFile = file;

          // 获取对应的设定库
          const settingFolder = manager.getSettingFolderForFile(file.path);
          if (!settingFolder) {
            this.decorations = Decoration.none;
            return;
          }

          // 提取关键字
          const keywords = await manager.extractKeywordsFromSettingFolder(settingFolder);

          if (keywords.size === 0) {
            this.decorations = Decoration.none;
            return;
          }

          // 创建装饰器
          const builder = new RangeSetBuilder<Decoration>();
          const doc = view.state.doc;
          const text = doc.toString();

          // 收集所有匹配位置
          const matches: { from: number; to: number }[] = [];

          // 为每个关键字查找匹配
          for (const keyword of keywords) {
            // 转义特殊字符
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedKeyword, 'g');

            let match;
            while ((match = regex.exec(text)) !== null) {
              matches.push({
                from: match.index,
                to: match.index + keyword.length
              });
            }
          }

          // 按位置排序并添加装饰器
          matches.sort((a, b) => a.from - b.from);

          for (const match of matches) {
            builder.add(
              match.from,
              match.to,
              Decoration.mark({
                class: "chinese-writer-highlight"
              })
            );
          }

          this.decorations = builder.finish();
        }

        update(update: ViewUpdate) {
          // 当文档改变时，重新计算装饰器
          if (update.docChanged) {
            this.updateDecorations(update.view);
          }
        }

        destroy() {
          // 清理
        }
      },
      {
        decorations: (value) => value.decorations
      }
    );
  }

  /**
   * 更新高亮样式
   */
  updateStyles(): void {
    const style = this.plugin.settings.highlightStyle;

    // 移除旧的样式
    const oldStyle = document.getElementById("chinese-writer-highlight-style");
    if (oldStyle) {
      oldStyle.remove();
    }

    // 创建新的样式
    const styleEl = document.createElement("style");
    styleEl.id = "chinese-writer-highlight-style";
    styleEl.textContent = `
      .chinese-writer-highlight {
        background-color: ${style.backgroundColor};
        border-bottom: ${style.borderWidth}px ${style.borderStyle} ${style.borderColor};
        font-weight: ${style.fontWeight};
        font-style: ${style.fontStyle};
        color: ${style.color};
        padding-bottom: 2px;
      }
    `;
    document.head.appendChild(styleEl);
  }
}
