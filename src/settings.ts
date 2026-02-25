import { App, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import type ChineseWriterPlugin from "./main";

/**
 * 文件夹对应关系
 */
export interface FolderMapping {
  /** 唯一ID */
  id: string;
  /** 小说库路径 */
  novelFolder: string;
  /** 设定库路径 */
  settingFolder: string;
}

/**
 * 高亮模式
 */
export type HighlightMode = "first" | "all";

/**
 * 高亮样式配置
 */
export interface HighlightStyle {
  /** 高亮模式 (first: 首次高亮, all: 全部高亮) */
  mode: HighlightMode;
  /** 背景色 */
  backgroundColor: string;
  /** 下划线样式 (solid, dashed, dotted, double, wavy) */
  borderStyle: string;
  /** 边框粗细 (px) */
  borderWidth: number;
  /** 边框颜色 */
  borderColor: string;
  /** 字体粗细 (normal, bold) */
  fontWeight: string;
  /** 字体样式 (normal, italic) */
  fontStyle: string;
  /** 文字颜色 */
  color: string;
}

/**
 * 高亮预览栏配置
 */
export interface HighlightPreviewStyle {
  /** 预览栏宽度（px） */
  width: number;
  /** 预览栏最大高度（px） */
  height: number;
  /** 下方内容最多显示行数（超出出现滚动条） */
  maxBodyLines: number;
}

/**
 * 常见标点检测配置
 */
export interface PunctuationCheckSettings {
  /** 总开关 */
  enabled: boolean;
  /** 英文逗号 , */
  comma: boolean;
  /** 英文句号 . */
  period: boolean;
  /** 英文冒号 : */
  colon: boolean;
  /** 英文分号 ; */
  semicolon: boolean;
  /** 英文感叹号 ! */
  exclamation: boolean;
  /** 英文问号 ? */
  question: boolean;
  /** 英文双引号 " 及中文双引号配对 */
  doubleQuote: boolean;
  /** 英文单引号 ' 及中文单引号配对 */
  singleQuote: boolean;
  /** 检测其他常见成对中文标点 */
  otherCnPairs: boolean;
}

/**
 * 插件设置接口
 */
export interface ChineseWriterSettings {
  /** 文件夹对应关系列表 */
  folderMappings: FolderMapping[];
  /** 高亮样式配置 */
  highlightStyle: HighlightStyle;
  /** 高亮预览栏配置 */
  highlightPreviewStyle: HighlightPreviewStyle;
  /** 常见标点检测配置 */
  punctuationCheck: PunctuationCheckSettings;
  /** 编辑区行首缩进（中文字符数） */
  editorIndentCjkChars: number;
  /** 编辑区行间距 */
  editorLineHeight: number;
  /** 编辑区段间距（px） */
  editorParagraphSpacing: number;
  /** 是否启用编辑区排版 */
  enableEditorTypography: boolean;
  /** 是否启用编辑区两端对齐 */
  enableEditorJustify: boolean;
  /** 是否启用正文高亮悬停预览 */
  enableEditorHoverPreview: boolean;
  /** 是否启用右边栏第3层节点悬停预览 */
  enableTreeH2HoverPreview: boolean;
  /** 通过插件功能打开/新建文件时是否在新标签页打开 */
  openInNewTab: boolean;
  /** 是否启用字符数统计功能 */
  enableMdStats: boolean;
  /** 字符统计是否仅统计 folderMappings 中配置的小说库与设定库 */
  mdStatsOnlyMappedFolders: boolean;
  /** 是否在编辑区标题前显示等级图标 */
  enableEditorHeadingIcons: boolean;
  /** 是否启用 // 候选栏 */
  enableSlashH2CandidateBar: boolean;
  /** 是否启用 // 英文片段候选栏 */
  enableSlashSnippetCandidateBar: boolean;
  /** // 候选栏每页最大显示项 */
  slashH2CandidatePageSize: number;
  /** // 文本片段来源目录路径（递归读取目录下所有 md） */
  slashSnippetFolderPath: string;
  /** 是否启用错别字与敏感词词典检测/修正 */
  enableTypoDictionary: boolean;
  /** 错别字与敏感词词典目录路径（递归读取目录下所有 md） */
  typoDictionaryFolderPath: string;
  /** 是否启用中文标点成对自动补齐 */
  enableCnPunctuationAutoPair: boolean;
}

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: ChineseWriterSettings = {
  folderMappings: [],
  highlightStyle: {
    mode: "all",
    backgroundColor: "#FFFFFF00",
    borderStyle: "dotted",
    borderWidth: 2,
    borderColor: "#4A86E9",
    fontWeight: "normal",
    fontStyle: "normal",
    color: "#4A86E9"
  },
  highlightPreviewStyle: {
    width: 300,
    height: 340,
    maxBodyLines: 12,
  },
  punctuationCheck: {
    enabled: false,
    comma: true,
    period: true,
    colon: true,
    semicolon: true,
    exclamation: true,
    question: true,
    doubleQuote: true,
    singleQuote: true,
    otherCnPairs: true,
  },
  editorIndentCjkChars: 2,
  editorLineHeight: 1.6,
  editorParagraphSpacing: 12,
  enableEditorTypography: false,
  enableEditorJustify: false,
  enableEditorHoverPreview: true,
  enableTreeH2HoverPreview: false,
  openInNewTab: true,
  enableMdStats: false,
  mdStatsOnlyMappedFolders: false,
  enableEditorHeadingIcons: false,
  enableSlashH2CandidateBar: false,
  enableSlashSnippetCandidateBar: false,
  slashH2CandidatePageSize: 8,
  slashSnippetFolderPath: "",
  enableTypoDictionary: false,
  typoDictionaryFolderPath: "",
  enableCnPunctuationAutoPair: false,
};

/**
 * 设置面板
 */
export class ChineseWriterSettingTab extends PluginSettingTab {
  plugin: ChineseWriterPlugin;
  private isAddingMapping = false;
  private delayedSaveTimer: number | null = null;
  private activeTabKey: "setting" | "quick" | "check" | "typography" | "other" = "setting";

  constructor(app: App, plugin: ChineseWriterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const folderPathSuggestions = this.getAllFolderPaths();
    const saveAndRefreshPunctuation = async () => {
      await this.plugin.saveSettings();
      this.refreshEditorHighlight();
    };
    const showTypoDictionaryReloadNotice = (
      status: "missing-path" | "invalid-folder" | "ok" | "error",
      trimmedPath: string,
      count: number
    ) => {
      if (trimmedPath.length > 0 && status === "invalid-folder") {
        new Notice("错别字与敏感词词典目录路径无效：请填写 Vault 内目录路径");
      } else if (status === "error") {
        new Notice("错别字与敏感词词典加载失败，请检查目录和文件内容");
      } else if (status === "ok" && count === 0 && trimmedPath.length > 0) {
        new Notice("错别字与敏感词词典目录已加载，但未解析到可用条目（每行格式：A@B 或 A）");
      }
    };
    const punctuationOptionToggles: Array<{ setDisabled: (disabled: boolean) => unknown }> = [];
    const setPunctuationOptionDisabled = (disabled: boolean) => {
      for (const toggle of punctuationOptionToggles) {
        toggle.setDisabled(disabled);
      }
    };

    containerEl.empty();

    containerEl.createEl("h2", { text: "中文写作插件设置", cls: "cw-settings-main-title" });

    const tabRoot = containerEl.createDiv({ cls: "cw-settings-tabs" });
    const tabBar = tabRoot.createDiv({ cls: "cw-settings-tab-bar" });
    const tabContent = tabRoot.createDiv({ cls: "cw-settings-tab-content" });

    const tabPanels = {
      setting: tabContent.createDiv({ cls: "cw-settings-tab-panel" }),
      quick: tabContent.createDiv({ cls: "cw-settings-tab-panel" }),
      check: tabContent.createDiv({ cls: "cw-settings-tab-panel" }),
      typography: tabContent.createDiv({ cls: "cw-settings-tab-panel" }),
      other: tabContent.createDiv({ cls: "cw-settings-tab-panel" }),
    };

    const tabDefs: Array<{ key: keyof typeof tabPanels; label: string }> = [
      { key: "setting", label: "设定管理" },
      { key: "quick", label: "快捷输入" },
      { key: "check", label: "文本纠错" },
      { key: "typography", label: "正文排版" },
      { key: "other", label: "其他功能" },
    ];

    const tabButtons = new Map<keyof typeof tabPanels, HTMLButtonElement>();
    const setActiveTab = (key: keyof typeof tabPanels) => {
      this.activeTabKey = key;
      tabDefs.forEach(({ key: tabKey }) => {
        const isActive = tabKey === key;
        const panel = tabPanels[tabKey];
        const button = tabButtons.get(tabKey);
        panel.hidden = !isActive;
        panel.toggleClass("is-active", isActive);
        if (button) {
          button.toggleClass("is-active", isActive);
          button.setAttribute("aria-selected", isActive ? "true" : "false");
        }
      });
    };

    tabDefs.forEach(({ key, label }) => {
      const button = tabBar.createEl("button", {
        text: label,
        cls: "cw-settings-tab-button",
      });
      button.type = "button";
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => setActiveTab(key));
      tabButtons.set(key, button);
    });

    if (!tabDefs.some((tab) => tab.key === this.activeTabKey)) {
      this.activeTabKey = "setting";
    }
    setActiveTab(this.activeTabKey);

    const settingTabEl = tabPanels.setting;
    const quickTabEl = tabPanels.quick;
    const checkTabEl = tabPanels.check;
    const typographyTabEl = tabPanels.typography;
    const otherTabEl = tabPanels.other;

    // 文件夹对应关系设置
    settingTabEl.createEl("h3", { text: "文件夹对应关系" });
    settingTabEl.createEl("p", {
      text: "配置小说库和设定库的对应关系。在小说库文件打开时，会显示对应设定库的内容，并高亮关键字。",
      cls: "setting-item-description"
    });

    // 显示现有的对应关系
    const mappingsContainer = settingTabEl.createDiv({ cls: "folder-mappings-container" });
    this.renderMappings(mappingsContainer);

    // 添加新对应关系按钮
    new Setting(settingTabEl)
      .setName("添加新对应关系")
      .addButton((button) =>
        button
          .setButtonText("添加")
          .setCta()
          .onClick(() => {
            if (this.isAddingMapping) {
              return; // 防止重复点击
            }
            this.addNewMapping();
          })
      );

    // 高亮样式设置
    settingTabEl.createEl("h3", { text: "关键字高亮样式" });

    new Setting(settingTabEl)
      .setName("高亮模式")
      .setDesc("选择关键字的高亮方式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("first", "首次高亮")
          .addOption("all", "全部高亮")
          .setValue(this.plugin.settings.highlightStyle.mode)
          .onChange(async (value: HighlightMode) => {
            this.plugin.settings.highlightStyle.mode = value;
            await this.plugin.saveSettings();
            this.refreshEditorHighlight();
          })
      );

    new Setting(settingTabEl)
      .setName("背景色")
      .setDesc("高亮关键字的背景颜色（支持8位HEX，如 #FFFFFF00，最后两位为透明度）")
      .addText((text) =>
        text
          .setPlaceholder("#FFFFFF00")
          .setValue(this.plugin.settings.highlightStyle.backgroundColor)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.backgroundColor = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(settingTabEl)
      .setName("下划线样式")
      .setDesc("高亮关键字的下划线样式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("solid", "实线")
          .addOption("dashed", "虚线")
          .addOption("dotted", "点线")
          .addOption("double", "双线")
          .addOption("wavy", "波浪线")
          .setValue(this.plugin.settings.highlightStyle.borderStyle)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.borderStyle = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(settingTabEl)
      .setName("下划线粗细")
      .setDesc("高亮关键字的下划线粗细（0-10像素）")
      .addSlider((slider) =>
        slider
          .setLimits(0, 10, 1)
          .setValue(this.plugin.settings.highlightStyle.borderWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.borderWidth = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(settingTabEl)
      .setName("下划线颜色")
      .setDesc("高亮关键字的下划线颜色")
      .addText((text) =>
        text
          .setPlaceholder("#4A86E9")
          .setValue(this.plugin.settings.highlightStyle.borderColor)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.borderColor = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(settingTabEl)
      .setName("字体粗细")
      .setDesc("高亮关键字的字体粗细")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("normal", "正常")
          .addOption("bold", "粗体")
          .setValue(this.plugin.settings.highlightStyle.fontWeight)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.fontWeight = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(settingTabEl)
      .setName("字体样式")
      .setDesc("高亮关键字的字体样式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("normal", "正常")
          .addOption("italic", "斜体")
          .setValue(this.plugin.settings.highlightStyle.fontStyle)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.fontStyle = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    new Setting(settingTabEl)
      .setName("文字颜色")
      .setDesc("高亮关键字的文字颜色（支持8位HEX，如 #4A86E9ff，inherit表示继承原有颜色）")
      .addText((text) =>
        text
          .setPlaceholder("#4A86E9")
          .setValue(this.plugin.settings.highlightStyle.color)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle.color = value;
            await this.plugin.saveSettings();
            this.updateHighlightStyles();
          })
      );

    // 高亮预览栏设置
    settingTabEl.createEl("h3", { text: "预览栏设置" });

    new Setting(settingTabEl)
      .setName("正文悬停预览")
      .setDesc("开启后，鼠标悬停正文高亮关键词时显示预览栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEditorHoverPreview)
          .onChange(async (value) => {
            this.plugin.settings.enableEditorHoverPreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(settingTabEl)
      .setName("右边栏悬停预览")
      .setDesc("开启后，鼠标悬停右边栏时显示预览栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTreeH2HoverPreview)
          .onChange(async (value) => {
            this.plugin.settings.enableTreeH2HoverPreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(settingTabEl)
      .setName("预览栏宽度")
      .setDesc("悬停预览栏宽度（像素）")
      .addSlider((slider) =>
        slider
          .setLimits(240, 720, 20)
          .setValue(this.plugin.settings.highlightPreviewStyle.width)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.highlightPreviewStyle.width = value;
            this.scheduleDelayedSave();
          })
      );

    new Setting(settingTabEl)
      .setName("预览栏高度")
      .setDesc("悬停预览栏最大高度（像素）")
      .addSlider((slider) =>
        slider
          .setLimits(160, 800, 20)
          .setValue(this.plugin.settings.highlightPreviewStyle.height)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.highlightPreviewStyle.height = value;
            this.scheduleDelayedSave();
          })
      );

    new Setting(settingTabEl)
      .setName("下方内容最多显示行数")
      .setDesc("超过该行数时显示滚动条")
      .addSlider((slider) =>
        slider
          .setLimits(3, 50, 1)
          .setValue(this.plugin.settings.highlightPreviewStyle.maxBodyLines)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.highlightPreviewStyle.maxBodyLines = value;
            this.scheduleDelayedSave();
          })
      );

    // 候选栏设置
    quickTabEl.createEl("h3", { text: "设定候选栏设置" });

    let candidatePageSizeText: HTMLDivElement | null = null;
    let candidatePageSizeSlider: { setDisabled: (disabled: boolean) => unknown } | null = null;
    const updateCandidatePageSizeDesc = (value: number) => {
      if (candidatePageSizeText) {
        candidatePageSizeText.setText(`当前每页最多显示 ${value} 项`);
      }
    };

    new Setting(quickTabEl)
      .setName("启用 // 设定候选栏")
      .setDesc("输入 // + 中文关键字时，从设定库中匹配设定候选词")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSlashH2CandidateBar)
          .onChange(async (value) => {
            this.plugin.settings.enableSlashH2CandidateBar = value;
            candidatePageSizeSlider?.setDisabled(!value);
            await this.plugin.saveSettings();
          })
      );

    const pageSizeSetting = new Setting(quickTabEl)
      .setName("每页最多显示项数")
      .setDesc("设定候选栏分页显示，每页最多展示的候选词数量")
      .addSlider((slider) =>
      (candidatePageSizeSlider = slider, slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.slashH2CandidatePageSize)
        .setDynamicTooltip()
        .setDisabled(!this.plugin.settings.enableSlashH2CandidateBar)
        .onChange((value) => {
          this.plugin.settings.slashH2CandidatePageSize = value;
          updateCandidatePageSizeDesc(value);
          this.scheduleDelayedSave();
        }))
      );
    candidatePageSizeText = pageSizeSetting.descEl.createDiv({
      cls: "setting-item-description",
      text: "",
    });
    updateCandidatePageSizeDesc(this.plugin.settings.slashH2CandidatePageSize);

    // 文本片段设置
    quickTabEl.createEl("h3", { text: "文本片段设置" });

    let snippetPathInput: { setDisabled: (disabled: boolean) => unknown } | null = null;
    new Setting(quickTabEl)
      .setName("启用 // 文本片段")
      .setDesc("输入 // + 英文关键字时，从指定目录的 Markdown 文本片段中匹配")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSlashSnippetCandidateBar)
          .onChange(async (value) => {
            this.plugin.settings.enableSlashSnippetCandidateBar = value;
            snippetPathInput?.setDisabled(!value);
            await this.plugin.saveSettings();
            if (value) {
              await this.plugin.slashSnippetCompleteManager.reloadSnippets();
            }
          })
      );

    new Setting(quickTabEl)
      .setName("文本片段目录路径")
      .setDesc("填写 Vault 内目录路径，递归读取该目录及子目录下所有 .md 文件")
      .addText((text) =>
      (snippetPathInput = text,
        text.inputEl.addEventListener("blur", async () => {
          const trimmed = this.plugin.settings.slashSnippetFolderPath.trim();
          this.plugin.settings.slashSnippetFolderPath = trimmed;
          await this.plugin.saveSettings();
          const result = await this.plugin.slashSnippetCompleteManager.reloadSnippets();
          if (trimmed.length > 0 && result.status === "invalid-folder") {
            new Notice("文本片段目录路径无效：请填写 Vault 内目录路径");
          } else if (result.status === "error") {
            new Notice("文本片段加载失败，请检查目录和文件内容");
          } else if (result.status === "ok" && result.count === 0) {
            new Notice("文本片段目录已加载，但未解析到可用片段（需使用 ## key 或 ## key@预览文字 + 正文）");
          }
        }),
        text
          .setPlaceholder("文本片段")
          .setValue(this.plugin.settings.slashSnippetFolderPath)
          .setDisabled(!this.plugin.settings.enableSlashSnippetCandidateBar)
          .onChange((value) => {
            this.plugin.settings.slashSnippetFolderPath = value;
            this.scheduleDelayedSave();
          }),
        this.bindFolderPathSuggestionPanel(text.inputEl, folderPathSuggestions))
      );

    // 常见标点检测设置
    checkTabEl.createEl("h3", { text: "常见标点检测" });

    new Setting(checkTabEl)
      .setName("启用常见标点检测")
      .setDesc("仅在已配置小说库中的 Markdown 文件内进行检测")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.enabled = value;
            await saveAndRefreshPunctuation();
            setPunctuationOptionDisabled(!value);
          })
      );

    new Setting(checkTabEl)
      .setName("检测英文逗号（,）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.comma)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.comma = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测英文句号（.）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.period)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.period = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测英文冒号（:）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.colon)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.colon = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测英文分号（;）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.semicolon)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.semicolon = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测英文感叹号（!）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.exclamation)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.exclamation = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测英文问号（?）")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.question)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.question = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测双引号")
      .setDesc("检测英文双引号（\"）与中文双引号（“”）配对错误")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.doubleQuote)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.doubleQuote = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测单引号")
      .setDesc("检测英文单引号（'）与中文单引号（‘’）配对错误")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.singleQuote)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.singleQuote = value;
            await saveAndRefreshPunctuation();
          });
      });

    new Setting(checkTabEl)
      .setName("检测其他常见成对中文标点")
      .setDesc("检测《》 （） 【】 〖〗 〈〉 〔〕 「」 『』 ｛｝ 的配对错误")
      .addToggle((toggle) => {
        punctuationOptionToggles.push(toggle);
        toggle
          .setValue(this.plugin.settings.punctuationCheck.otherCnPairs)
          .setDisabled(!this.plugin.settings.punctuationCheck.enabled)
          .onChange(async (value) => {
            this.plugin.settings.punctuationCheck.otherCnPairs = value;
            await saveAndRefreshPunctuation();
          });
      });

    // 自定义错别字词典设置
    checkTabEl.createEl("h3", { text: "自定义错别字与敏感词检测" });

    let typoDictionaryPathInput: { setDisabled: (disabled: boolean) => unknown } | null = null;

    new Setting(checkTabEl)
      .setName("启用自定义错别字与敏感词词典")
      .setDesc("开启后，在正文中标记错别字与敏感词并支持批量修正")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTypoDictionary)
          .onChange(async (value) => {
            this.plugin.settings.enableTypoDictionary = value;
            typoDictionaryPathInput?.setDisabled(!value);
            await this.plugin.saveSettings();
            const result = await this.plugin.highlightManager.reloadTypoDictionary();
            showTypoDictionaryReloadNotice(
              result.status,
              this.plugin.settings.typoDictionaryFolderPath.trim(),
              result.count
            );
            this.refreshEditorHighlight();
          })
      );

    new Setting(checkTabEl)
      .setName("错别字与敏感词词典目录路径")
      .setDesc("填写 Vault 内目录路径，递归读取该目录及子目录下所有 .md 文件")
      .addText((text) =>
      (typoDictionaryPathInput = text,
        text.inputEl.addEventListener("blur", async () => {
          const trimmed = this.plugin.settings.typoDictionaryFolderPath.trim();
          this.plugin.settings.typoDictionaryFolderPath = trimmed;
          await this.plugin.saveSettings();
          const result = await this.plugin.highlightManager.reloadTypoDictionary();
          showTypoDictionaryReloadNotice(result.status, trimmed, result.count);
          this.refreshEditorHighlight();
        }),
        text
          .setPlaceholder("错别字与敏感词词典")
          .setValue(this.plugin.settings.typoDictionaryFolderPath)
          .setDisabled(!this.plugin.settings.enableTypoDictionary)
          .onChange((value) => {
            this.plugin.settings.typoDictionaryFolderPath = value;
            this.scheduleDelayedSave();
          }),
        this.bindFolderPathSuggestionPanel(text.inputEl, folderPathSuggestions))
      );

    // 编辑区排版设置
    typographyTabEl.createEl("h3", { text: "编辑区排版" });

    new Setting(typographyTabEl)
      .setName("启用编辑区排版")
      .setDesc("关闭后不应用行首缩进、行间距和段间距")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEditorTypography)
          .onChange(async (value) => {
            this.plugin.settings.enableEditorTypography = value;
            await this.plugin.saveSettings();
            this.updateEditorTypographyStyles();
          })
      );



    new Setting(typographyTabEl)
      .setName("行首缩进（中文字符）")
      .setDesc("仅编辑视图生效，按中文字符宽度缩进")
      .addSlider((slider) =>
        slider
          .setLimits(0, 6, 0.5)
          .setValue(this.plugin.settings.editorIndentCjkChars)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.editorIndentCjkChars = value;
            this.updateEditorTypographyStyles();
            this.scheduleDelayedSave();
          })
      );

    new Setting(typographyTabEl)
      .setName("行间距")
      .setDesc("仅编辑视图生效")
      .addSlider((slider) =>
        slider
          .setLimits(1.2, 2.6, 0.1)
          .setValue(this.plugin.settings.editorLineHeight)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.editorLineHeight = value;
            this.updateEditorTypographyStyles();
            this.scheduleDelayedSave();
          })
      );

    new Setting(typographyTabEl)
      .setName("段间距")
      .setDesc("仅编辑视图生效；与行间距独立，不叠加")
      .addSlider((slider) =>
        slider
          .setLimits(0, 32, 1)
          .setValue(this.plugin.settings.editorParagraphSpacing)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.editorParagraphSpacing = value;
            this.updateEditorTypographyStyles();
            this.scheduleDelayedSave();
          })
      );



    // 文件打开行为设置
    otherTabEl.createEl("h3", { text: "文件打开行为" });

    new Setting(otherTabEl)
      .setName("在新标签页打开")
      .setDesc("通过插件内相关功能打开或新建文件时，是否在新标签页打开（已打开则复用现有标签）")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openInNewTab)
          .onChange(async (value) => {
            this.plugin.settings.openInNewTab = value;
            await this.plugin.saveSettings();
          })
      );

    // 其他便捷功能
    otherTabEl.createEl("h3", { text: "其他便捷功能" });

    new Setting(otherTabEl)
      .setName("启用字符数统计")
      .setDesc("关闭后不显示统计，且不在后台执行字符统计")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableMdStats)
          .onChange(async (value) => {
            this.plugin.settings.enableMdStats = value;
            await this.plugin.saveSettings();
            this.plugin.mdStatsManager.setEnabled(value);
          })
      );

    new Setting(otherTabEl)
      .setName("仅统计小说库与设定库")
      .setDesc("开启后文件管理器仅统计文件夹对应关系中配置的小说库和设定库；状态栏字数统计不受影响")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mdStatsOnlyMappedFolders)
          .onChange(async (value) => {
            this.plugin.settings.mdStatsOnlyMappedFolders = value;
            await this.plugin.saveSettings();
            this.plugin.mdStatsManager.onVaultFileChanged();
          })
      );

    new Setting(otherTabEl)
      .setName("编辑区标题图标")
      .setDesc("在编辑视图各级标题前显示对应等级图标")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEditorHeadingIcons)
          .onChange(async (value) => {
            this.plugin.settings.enableEditorHeadingIcons = value;
            await this.plugin.saveSettings();
            this.plugin.mdStatsManager.refreshEditorDecorations();
          })
      );

    new Setting(otherTabEl)
      .setName("两端对齐")
      .setDesc("开启后编辑区正文使用两端对齐，并启用自动断词")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEditorJustify)
          .onChange(async (value) => {
            this.plugin.settings.enableEditorJustify = value;
            await this.plugin.saveSettings();
            this.updateEditorTypographyStyles();
          })
      );

    new Setting(otherTabEl)
      .setName("中文标点成对补齐")
      .setDesc("输入前半中文标点时自动补齐后半标点，光标保持在中间")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCnPunctuationAutoPair)
          .onChange(async (value) => {
            this.plugin.settings.enableCnPunctuationAutoPair = value;
            await this.plugin.saveSettings();
          })
      );

  }

  /**
   * 渲染文件夹对应关系列表
   */
  private renderMappings(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.folderMappings.length === 0) {
      container.createEl("p", {
        text: "暂无对应关系，请点击下方按钮添加。",
        cls: "setting-item-description"
      });
      return;
    }

    this.plugin.settings.folderMappings.forEach((mapping) => {
      const novelFolder = mapping.novelFolder || "未设置";
      const settingFolder = mapping.settingFolder || "未设置";
      const novelMissing = !!mapping.novelFolder && !this.isFolderExisting(mapping.novelFolder);
      const settingMissing = !!mapping.settingFolder && !this.isFolderExisting(mapping.settingFolder);

      const mappingSetting = new Setting(container)
        .setName("")
        .setClass("folder-mapping-item")
        .addButton((button) =>
          button
            .setButtonText("编辑")
            .onClick(async () => {
              await this.editMapping(mapping);
            })
        )
        .addButton((button) =>
          button
            .setButtonText("删除")
            .setWarning()
            .onClick(async () => {
              if (mapping.settingFolder) {
                await this.plugin.orderManager.removeFolderData(mapping.settingFolder);
              }
              this.plugin.settings.folderMappings =
                this.plugin.settings.folderMappings.filter(m => m.id !== mapping.id);
              await this.plugin.saveSettings();
              await this.plugin.refreshView();
              this.refreshEditorHighlight();
              this.display();
            })
        );

      mappingSetting.nameEl.empty();
      this.appendFolderDisplay(mappingSetting.nameEl, novelFolder, novelMissing);
      mappingSetting.nameEl.createSpan({ text: " → ", cls: "cw-folder-mapping-arrow" });
      this.appendFolderDisplay(mappingSetting.nameEl, settingFolder, settingMissing);
    });
  }

  private appendFolderDisplay(parent: HTMLElement, folderName: string, isMissing: boolean): void {
    parent.createSpan({ text: folderName, cls: "cw-folder-mapping-name" });
    if (isMissing) {
      parent.createSpan({ text: "（已丢失）", cls: "cw-folder-mapping-missing" });
    }
  }

  private isFolderExisting(folderPath: string): boolean {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    return folder instanceof TFolder;
  }

  /**
   * 编辑现有的对应关系
   */
  private async editMapping(mapping: FolderMapping): Promise<void> {
    const { TextInputModal } = await import("./modals");
    const oldSettingFolder = mapping.settingFolder;
    const folderSuggestions = this.getAllFolderPaths();

    // 第一次弹出：编辑小说库路径
    new TextInputModal(
      this.app,
      "编辑对应关系 - 步骤 1/2",
      "请输入小说库路径（相对于仓库根目录）",
      mapping.novelFolder,
      async (novelFolder) => {
        if (!novelFolder.trim()) {
          return;
        }

        // 第二次弹出：编辑设定库路径（紧接第一步，避免背景闪烁）
        new TextInputModal(
          this.app,
          "编辑对应关系 - 步骤 2/2",
          "请输入设定库路径（相对于仓库根目录）",
          mapping.settingFolder,
          async (settingFolder) => {
            if (!settingFolder.trim()) {
              return;
            }

            // 更新对应关系
            mapping.novelFolder = novelFolder.trim();
            mapping.settingFolder = settingFolder.trim();

            if (oldSettingFolder) {
              await this.plugin.orderManager.removeFolderData(oldSettingFolder);
            }
            await this.plugin.saveSettings();

            // 延迟刷新界面和编辑器，确保弹出框完全关闭
            setTimeout(async () => {
              await this.plugin.refreshView();
              this.refreshEditorHighlight();
              this.display();
            }, 50);
          },
          folderSuggestions
        ).open();
      },
      folderSuggestions
    ).open();
  }

  /**
   * 添加新的对应关系（使用两次弹出输入框）
   */
  private async addNewMapping(): Promise<void> {
    if (this.isAddingMapping) {
      return; // 防止重复调用
    }

    this.isAddingMapping = true;
    const { TextInputModal } = await import("./modals");
    const folderSuggestions = this.getAllFolderPaths();

    // 第一次弹出：输入小说库路径
    new TextInputModal(
      this.app,
      "添加对应关系 - 步骤 1/2",
      "请输入小说库路径（相对于仓库根目录）",
      "",
      async (novelFolder) => {
        if (!novelFolder.trim()) {
          this.isAddingMapping = false;
          return;
        }

        // 第二次弹出：输入设定库路径（紧接第一步，避免背景闪烁）
        new TextInputModal(
          this.app,
          "添加对应关系 - 步骤 2/2",
          "请输入设定库路径（相对于仓库根目录）",
          "",
          async (settingFolder) => {
            if (!settingFolder.trim()) {
              this.isAddingMapping = false;
              return;
            }

            // 创建新的对应关系
            const newMapping: FolderMapping = {
              id: Date.now().toString(),
              novelFolder: novelFolder.trim(),
              settingFolder: settingFolder.trim()
            };

            this.plugin.settings.folderMappings.push(newMapping);
            await this.plugin.saveSettings();

            // 延迟刷新界面和编辑器，确保弹出框完全关闭
            setTimeout(async () => {
              await this.plugin.refreshView();
              this.refreshEditorHighlight();
              this.display();
              this.isAddingMapping = false; // 完成后重置标志
            }, 50);
          },
          folderSuggestions,
          () => {
            this.isAddingMapping = false;
          }
        ).open();
      },
      folderSuggestions,
      () => {
        this.isAddingMapping = false;
      }
    ).open();
  }

  private getAllFolderPaths(): string[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .filter((path) => path.trim().length > 0)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }

  private bindFolderPathSuggestionPanel(inputEl: HTMLInputElement, suggestions: string[]): void {
    document
      .querySelectorAll(".cw-snippet-folder-suggestion-container")
      .forEach((el) => el.remove());

    const suggestionContainer = document.createElement("div");
    suggestionContainer.classList.add(
      "cw-suggestion-container",
      "cw-suggestion-container-floating",
      "cw-snippet-folder-suggestion-container"
    );
    document.body.appendChild(suggestionContainer);
    suggestionContainer.hidden = true;

    let filteredSuggestions: string[] = [];
    let activeSuggestionIndex = -1;

    const updateSuggestionPosition = () => {
      const rect = inputEl.getBoundingClientRect();
      suggestionContainer.style.left = `${Math.round(rect.left)}px`;
      suggestionContainer.style.top = `${Math.round(rect.bottom + 4)}px`;
      suggestionContainer.style.width = `${Math.round(rect.width)}px`;
    };

    const updateActiveSuggestion = () => {
      const rows = Array.from(suggestionContainer.children) as HTMLElement[];
      rows.forEach((row, idx) => {
        row.classList.toggle("is-active", idx === activeSuggestionIndex);
      });
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < rows.length) {
        rows[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });
      }
    };

    const acceptActiveSuggestion = (): boolean => {
      if (activeSuggestionIndex < 0 || activeSuggestionIndex >= filteredSuggestions.length) {
        return false;
      }
      const selected = filteredSuggestions[activeSuggestionIndex];
      if (!selected) return false;
      inputEl.value = selected;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      suggestionContainer.hidden = true;
      suggestionContainer.empty();
      filteredSuggestions = [];
      activeSuggestionIndex = -1;
      return true;
    };

    const renderSuggestions = (keyword: string) => {
      const normalized = keyword.trim().toLowerCase();
      if (!normalized) {
        suggestionContainer.hidden = true;
        suggestionContainer.empty();
        filteredSuggestions = [];
        activeSuggestionIndex = -1;
        return;
      }

      filteredSuggestions = suggestions
        .filter((item) => item.toLowerCase().includes(normalized))
        .slice(0, 80);

      suggestionContainer.empty();
      if (filteredSuggestions.length === 0) {
        suggestionContainer.hidden = true;
        activeSuggestionIndex = -1;
        return;
      }

      suggestionContainer.hidden = false;
      updateSuggestionPosition();
      activeSuggestionIndex = 0;

      filteredSuggestions.forEach((item, idx) => {
        const row = suggestionContainer.createDiv({ text: item, cls: "cw-suggestion-row" });
        row.addEventListener("mouseenter", () => {
          activeSuggestionIndex = idx;
          updateActiveSuggestion();
        });
        row.addEventListener("click", () => {
          activeSuggestionIndex = idx;
          acceptActiveSuggestion();
          inputEl.focus();
        });
      });

      updateActiveSuggestion();
    };

    inputEl.addEventListener("focus", () => renderSuggestions(inputEl.value));
    inputEl.addEventListener("input", () => {
      activeSuggestionIndex = 0;
      renderSuggestions(inputEl.value);
    });
    inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" && !suggestionContainer.hidden) {
        event.preventDefault();
        if (filteredSuggestions.length > 0) {
          activeSuggestionIndex =
            (activeSuggestionIndex + 1 + filteredSuggestions.length) % filteredSuggestions.length;
          updateActiveSuggestion();
        }
      } else if (event.key === "ArrowUp" && !suggestionContainer.hidden) {
        event.preventDefault();
        if (filteredSuggestions.length > 0) {
          activeSuggestionIndex =
            activeSuggestionIndex <= 0 ? filteredSuggestions.length - 1 : activeSuggestionIndex - 1;
          updateActiveSuggestion();
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (!suggestionContainer.hidden && filteredSuggestions.length > 0) {
          acceptActiveSuggestion();
        }
        inputEl.blur();
      } else if (event.key === "Escape" && !suggestionContainer.hidden) {
        event.preventDefault();
        suggestionContainer.hidden = true;
      }
    });
    inputEl.addEventListener("blur", () => {
      setTimeout(() => {
        suggestionContainer.hidden = true;
      }, 120);
    });
  }

  /**
   * 更新高亮样式
   */
  private updateHighlightStyles(): void {
    // 触发编辑器更新高亮样式
    if (this.plugin.highlightManager) {
      this.plugin.highlightManager.updateStyles();
    }
  }

  /**
   * 刷新编辑器高亮
   */
  private refreshEditorHighlight(): void {
    // 清除关键字缓存并强制刷新编辑器
    if (this.plugin.highlightManager) {
      this.plugin.highlightManager.refreshCurrentEditor();
    }
  }

  private updateEditorTypographyStyles(): void {
    if (this.plugin.editorTypographyManager) {
      this.plugin.editorTypographyManager.updateStyles();
    }
  }

  private scheduleDelayedSave(delayMs = 350): void {
    if (this.delayedSaveTimer !== null) {
      window.clearTimeout(this.delayedSaveTimer);
    }
    this.delayedSaveTimer = window.setTimeout(() => {
      this.delayedSaveTimer = null;
      void this.plugin.saveSettings();
    }, delayMs);
  }
}
