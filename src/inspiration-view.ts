import { ItemView, MarkdownRenderer, Notice, TFile, TFolder, WorkspaceLeaf, setIcon } from "obsidian";
import type ChineseWriterPlugin from "./main";
import { ConfirmModal } from "./modals";

export const VIEW_TYPE_INSPIRATION = "chinese-writer-inspiration-view";

type SortMode = "ctime-asc" | "ctime-desc" | "mtime-asc" | "mtime-desc";

interface ParsedCardContent {
  frontmatterBody: string | null;
  cwDataBody: string | null;
  body: string;
  color: string | null;
  isPinned: boolean;
}

interface CardRenderModel extends ParsedCardContent {
  file: TFile;
}

export class InspirationView extends ItemView {
  plugin: ChineseWriterPlugin;
  private static readonly CW_DATA_WARNING = "数据由灵感视图管理，请勿删除或手动修改";
  private static readonly CARD_COLORS = [
    "#4A86E9",
    "#7B61FF",
    "#47B881",
    "#F6C445",
    "#F59E0B",
    "#F05D6C",
    "#9CA3AF",
  ];
  private sortMode: SortMode = "mtime-desc";
  private cardMenuEl: HTMLElement | null = null;
  private sortMenuEl: HTMLElement | null = null;
  private menuCleanup: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, plugin: ChineseWriterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_INSPIRATION;
  }

  getDisplayText(): string {
    return "灵感视图";
  }

  getIcon(): string {
    return "lightbulb";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.closeMenus();
  }

  async refresh(): Promise<void> {
    const container = this.containerEl.children[1];
    if (!container) return;
    container.empty();
    container.addClass("chinese-writer-view");

    const headerEl = container.createDiv({ cls: "chinese-writer-header" });
    const titleEl = headerEl.createDiv({ cls: "chinese-writer-title" });
    const iconEl = titleEl.createSpan({ cls: "chinese-writer-icon" });
    setIcon(iconEl, "lightbulb");
    titleEl.createSpan({ text: "灵感视图", cls: "chinese-writer-folder-name" });

    const sortBtn = headerEl.createEl("button", { cls: "chinese-writer-toggle-btn" });
    setIcon(sortBtn, this.getSortButtonIcon(this.sortMode));
    sortBtn.setAttribute("aria-label", "排序");
    sortBtn.setAttribute("title", `排序：${this.getSortLabel(this.sortMode)}`);
    sortBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.openSortMenu(sortBtn);
    });

    const contentEl = container.createDiv({ cls: "cw-inspiration-content" });
    const configuredPath = this.plugin.settings.inspirationFolderPath.trim();
    if (!configuredPath) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "未设置灵感文件路径，请到 设置 -> 其他功能 -> 其他便捷功能 中填写。",
      });
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(configuredPath);
    if (!(folder instanceof TFolder)) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "灵感文件路径无效，请填写 Vault 内目录路径。",
      });
      return;
    }

    const files = this.plugin.parser
      .getMarkdownFilesInFolder(configuredPath)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    if (files.length === 0) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "该目录下暂无 Markdown 文件。",
      });
      return;
    }

    const cardModels = await Promise.all(
      files.map(async (file) => {
        const content = await this.app.vault.cachedRead(file);
        const parsed = this.parseCardContent(content);
        return { file, ...parsed } as CardRenderModel;
      })
    );
    cardModels.sort((a, b) => this.compareCards(a, b));

    const listEl = contentEl.createDiv({ cls: "cw-inspiration-list" });
    for (const model of cardModels) {
      await this.renderFileItem(listEl, model);
    }
  }

  private compareCards(a: CardRenderModel, b: CardRenderModel): number {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    switch (this.sortMode) {
      case "ctime-asc":
        return a.file.stat.ctime - b.file.stat.ctime;
      case "ctime-desc":
        return b.file.stat.ctime - a.file.stat.ctime;
      case "mtime-asc":
        return a.file.stat.mtime - b.file.stat.mtime;
      case "mtime-desc":
      default:
        return b.file.stat.mtime - a.file.stat.mtime;
    }
  }

  private async renderFileItem(listEl: HTMLElement, model: CardRenderModel): Promise<void> {
    const { file } = model;
    let frontmatterBody = model.frontmatterBody;
    let cwDataBody = model.cwDataBody;
    let isPinned = model.isPinned;
    let currentColor = model.color;

    const itemEl = listEl.createDiv({ cls: "cw-inspiration-item" });
    itemEl.style.setProperty("--cw-inspiration-lines", String(this.getCollapsedLines()));
    const barEl = itemEl.createDiv({ cls: "cw-inspiration-item-bar" });
    const timeEl = barEl.createDiv({
      cls: "cw-inspiration-item-time",
      text: this.formatTimestamp(file.stat.mtime),
    });
    const moreBtn = barEl.createEl("button", {
      cls: "cw-inspiration-item-more",
      attr: { type: "button", "aria-label": "更多操作" },
    });
    setIcon(moreBtn, "ellipsis");

    const previewEl = itemEl.createDiv({ cls: "cw-inspiration-item-preview markdown-rendered" });
    const textareaEl = itemEl.createEl("textarea", { cls: "cw-inspiration-item-editor is-hidden" });
    let currentBody = model.body;
    textareaEl.value = currentBody;
    textareaEl.setAttribute("aria-label", `${file.basename} 编辑区`);
    await this.renderPreview(previewEl, currentBody, file.path);
    this.applyCardColor(itemEl, model.color);
    this.setEditorExpanded(textareaEl, false);

    let lastSavedContent = this.composeContent(frontmatterBody, cwDataBody, textareaEl.value);
    const saveContent = async () => {
      const nextComposed = this.composeContent(frontmatterBody, cwDataBody, textareaEl.value);
      if (nextComposed === lastSavedContent) return;
      try {
        await this.app.vault.modify(file, nextComposed);
        lastSavedContent = nextComposed;
        currentBody = textareaEl.value;
        await this.renderPreview(previewEl, currentBody, file.path);
        timeEl.setText(this.formatTimestamp(Date.now()));
      } catch (error) {
        console.error("Failed to save inspiration file:", error);
        new Notice("灵感卡片保存失败，请重试");
      }
    };

    moreBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.openCardMenu(moreBtn, {
        pinned: isPinned,
        selectedColor: currentColor,
        onSelectColor: async (hex) => {
          const nextCwData = this.upsertCwDataColor(cwDataBody, hex);
          const updated = this.composeContent(frontmatterBody, nextCwData, textareaEl.value);
          if (updated === lastSavedContent) return;
          try {
            await this.app.vault.modify(file, updated);
            cwDataBody = nextCwData;
            lastSavedContent = updated;
            currentColor = hex.toUpperCase();
            this.applyCardColor(itemEl, hex);
            timeEl.setText(this.formatTimestamp(Date.now()));
          } catch (error) {
            console.error("Failed to save inspiration card color:", error);
            new Notice("设置灵感颜色失败，请重试");
          }
        },
        onTogglePinned: async () => {
          const nextPinned = !isPinned;
          const nextCwData = this.upsertCwDataPinned(cwDataBody, nextPinned);
          const updated = this.composeContent(frontmatterBody, nextCwData, textareaEl.value);
          if (updated === lastSavedContent) return;
          try {
            await this.app.vault.modify(file, updated);
            cwDataBody = nextCwData;
            isPinned = nextPinned;
            lastSavedContent = updated;
            await this.refresh();
          } catch (error) {
            console.error("Failed to save pin state:", error);
            new Notice("置顶设置失败，请重试");
          }
        },
        onDelete: async () => {
          const modal = new ConfirmModal(
            this.app,
            "删除灵感",
            "确定要删除该灵感吗？此操作不可恢复。",
            () => {
              void (async () => {
                try {
                  await this.app.vault.trash(file, true);
                  itemEl.remove();
                } catch (error) {
                  console.error("Failed to delete inspiration file:", error);
                  new Notice("删除灵感失败，请重试");
                }
              })();
            }
          );
          modal.open();
        },
      });
    });

    textareaEl.addEventListener("input", () => {
      this.setEditorExpanded(textareaEl, document.activeElement === textareaEl);
    });
    textareaEl.addEventListener("focus", () => {
      this.setEditorExpanded(textareaEl, true);
    });
    textareaEl.addEventListener("blur", () => {
      this.setEditorExpanded(textareaEl, false);
      previewEl.removeClass("is-hidden");
      textareaEl.addClass("is-hidden");
      void saveContent();
    });
    textareaEl.addEventListener("keydown", (evt) => {
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "s") {
        evt.preventDefault();
        evt.stopPropagation();
        void saveContent();
      }
    });

    previewEl.addEventListener("click", () => {
      previewEl.addClass("is-hidden");
      textareaEl.removeClass("is-hidden");
      textareaEl.focus();
      textareaEl.setSelectionRange(textareaEl.value.length, textareaEl.value.length);
      this.setEditorExpanded(textareaEl, true);
    });
  }

  private async renderPreview(previewEl: HTMLElement, body: string, sourcePath: string): Promise<void> {
    previewEl.empty();
    const normalized = body.trim();
    if (!normalized) {
      previewEl.createEl("p", { text: "" });
      return;
    }
    await MarkdownRenderer.render(this.app, normalized, previewEl, sourcePath, this);
  }

  private setEditorExpanded(textareaEl: HTMLTextAreaElement, expanded: boolean): void {
    const collapsedMaxHeight = this.getCollapsedMaxHeight(textareaEl);
    textareaEl.style.maxHeight = expanded ? "none" : `${collapsedMaxHeight}px`;
    textareaEl.style.height = "0px";
    const fullHeight = textareaEl.scrollHeight;
    const nextHeight = expanded ? Math.max(fullHeight, collapsedMaxHeight) : collapsedMaxHeight;
    textareaEl.style.height = `${nextHeight}px`;
  }

  private getCollapsedMaxHeight(textareaEl: HTMLTextAreaElement): number {
    const computed = window.getComputedStyle(textareaEl);
    const fontSize = Number.parseFloat(computed.fontSize) || 16;
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.6;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    return lineHeight * this.getCollapsedLines() + paddingTop + paddingBottom;
  }

  private getCollapsedLines(): number {
    const raw = this.plugin.settings.inspirationPreviewLines;
    const normalized = Number.isFinite(raw) ? Math.round(raw) : 3;
    return Math.min(10, Math.max(1, normalized));
  }

  private formatTimestamp(ms: number): string {
    const dt = new Date(ms);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    const ss = String(dt.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }

  private getSortLabel(mode: SortMode): string {
    switch (mode) {
      case "ctime-asc":
        return "按创建时间升序";
      case "ctime-desc":
        return "按创建时间降序";
      case "mtime-asc":
        return "按编辑时间升序";
      case "mtime-desc":
      default:
        return "按编辑时间降序";
    }
  }

  private getSortButtonIcon(mode: SortMode): string {
    if (mode === "ctime-asc" || mode === "mtime-asc") {
      return "calendar-arrow-up";
    }
    return "calendar-arrow-down";
  }

  private openSortMenu(anchorEl: HTMLElement): void {
    if (this.sortMenuEl && this.sortMenuEl.dataset.anchorId === String(anchorEl.dataset.menuAnchorId ?? "")) {
      this.closeMenus();
      return;
    }
    this.closeMenus();

    const anchorId = String(Date.now() + Math.random());
    anchorEl.dataset.menuAnchorId = anchorId;
    const menuEl = document.createElement("div");
    menuEl.className = "cw-inspiration-color-menu";
    menuEl.dataset.anchorId = anchorId;

    const options: Array<{ mode: SortMode; label: string }> = [
      { mode: "ctime-asc", label: "按创建时间升序" },
      { mode: "ctime-desc", label: "按创建时间降序" },
      { mode: "mtime-asc", label: "按编辑时间升序" },
      { mode: "mtime-desc", label: "按编辑时间降序" },
    ];

    const actionsEl = menuEl.createDiv({ cls: "cw-inspiration-menu-actions no-divider" });
    for (const [index, option] of options.entries()) {
      if (index === 2) {
        actionsEl.createDiv({ cls: "cw-inspiration-menu-divider" });
      }
      const btn = actionsEl.createEl("button", {
        cls: "cw-inspiration-menu-item",
        attr: { type: "button" },
      });
      const iconEl = btn.createSpan({ cls: "cw-inspiration-menu-item-icon" });
      setIcon(iconEl, option.mode.endsWith("asc") ? "calendar-arrow-up" : "calendar-arrow-down");
      btn.createSpan({ cls: "cw-inspiration-menu-item-text", text: option.label });
      if (option.mode === this.sortMode) {
        btn.addClass("is-active");
      }
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.sortMode = option.mode;
        void this.refresh();
        this.closeMenus();
      });
    }

    document.body.appendChild(menuEl);
    this.positionMenu(anchorEl, menuEl);
    this.sortMenuEl = menuEl;
    this.registerMenuCloseHandlers(menuEl, anchorEl);
  }

  private openCardMenu(
    anchorEl: HTMLElement,
    handlers: {
      pinned: boolean;
      selectedColor: string | null;
      onSelectColor: (hex: string) => Promise<void>;
      onTogglePinned: () => Promise<void>;
      onDelete: () => Promise<void>;
    }
  ): void {
    if (this.cardMenuEl && this.cardMenuEl.dataset.anchorId === String(anchorEl.dataset.menuAnchorId ?? "")) {
      this.closeMenus();
      return;
    }
    this.closeMenus();

    const anchorId = String(Date.now() + Math.random());
    anchorEl.dataset.menuAnchorId = anchorId;
    const menuEl = document.createElement("div");
    menuEl.className = "cw-inspiration-color-menu";
    menuEl.dataset.anchorId = anchorId;

    const paletteEl = menuEl.createDiv({ cls: "cw-inspiration-color-palette" });
    for (const hex of InspirationView.CARD_COLORS) {
      const swatchEl = paletteEl.createEl("button", {
        cls: "cw-inspiration-color-swatch",
        attr: { type: "button", "aria-label": `颜色 ${hex}` },
      });
      swatchEl.style.backgroundColor = this.hexToRgba(hex, 0.25);
      if ((handlers.selectedColor ?? "").toUpperCase() === hex.toUpperCase()) {
        swatchEl.addClass("is-selected");
      }
      swatchEl.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        void handlers.onSelectColor(hex).finally(() => this.closeMenus());
      });
    }

    const actionsEl = menuEl.createDiv({ cls: "cw-inspiration-menu-actions" });

    const pinEl = actionsEl.createEl("button", {
      cls: "cw-inspiration-menu-item",
      attr: { type: "button" },
    });
    const pinIconEl = pinEl.createSpan({ cls: "cw-inspiration-menu-item-icon" });
    setIcon(pinIconEl, handlers.pinned ? "pin-off" : "pin");
    pinEl.createSpan({
      cls: "cw-inspiration-menu-item-text",
      text: handlers.pinned ? "取消置顶" : "置顶",
    });
    pinEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void handlers.onTogglePinned().finally(() => this.closeMenus());
    });

    const deleteEl = actionsEl.createEl("button", {
      cls: "cw-inspiration-menu-item is-danger",
      attr: { type: "button" },
    });
    const deleteIconEl = deleteEl.createSpan({ cls: "cw-inspiration-menu-item-icon" });
    setIcon(deleteIconEl, "trash-2");
    deleteEl.createSpan({
      cls: "cw-inspiration-menu-item-text",
      text: "删除灵感",
    });
    deleteEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void handlers.onDelete().finally(() => this.closeMenus());
    });

    document.body.appendChild(menuEl);
    this.positionMenu(anchorEl, menuEl);
    this.cardMenuEl = menuEl;
    this.registerMenuCloseHandlers(menuEl, anchorEl);
  }

  private registerMenuCloseHandlers(menuEl: HTMLElement, anchorEl: HTMLElement): void {
    const onPointerDown = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (menuEl.contains(target) || anchorEl.contains(target)) return;
      this.closeMenus();
    };
    const onWindowChange = () => this.closeMenus();
    document.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    this.menuCleanup.push(() => document.removeEventListener("mousedown", onPointerDown, true));
    this.menuCleanup.push(() => window.removeEventListener("resize", onWindowChange));
    this.menuCleanup.push(() => window.removeEventListener("scroll", onWindowChange, true));
  }

  private positionMenu(anchorEl: HTMLElement, menuEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const menuWidth = menuEl.offsetWidth || 180;
    const menuHeight = menuEl.offsetHeight || 120;
    let left = rect.right - menuWidth;
    let top = rect.bottom + gap;
    if (left + menuWidth > window.innerWidth - margin) {
      left = window.innerWidth - margin - menuWidth;
    }
    if (left < margin) {
      left = margin;
    }
    if (top + menuHeight > window.innerHeight - margin) {
      top = rect.top - gap - menuHeight;
    }
    if (top < margin) {
      top = margin;
    }
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  private closeMenus(): void {
    if (this.cardMenuEl) {
      this.cardMenuEl.remove();
      this.cardMenuEl = null;
    }
    if (this.sortMenuEl) {
      this.sortMenuEl.remove();
      this.sortMenuEl = null;
    }
    while (this.menuCleanup.length > 0) {
      const fn = this.menuCleanup.pop();
      if (fn) fn();
    }
  }

  private parseCardContent(content: string): ParsedCardContent {
    const normalized = content.replace(/\r\n?/g, "\n");
    const frontmatterInfo = this.getFrontmatterInfo(normalized);
    const frontmatterBody = frontmatterInfo?.body ?? null;
    const afterFrontmatter = frontmatterInfo ? normalized.slice(frontmatterInfo.endIndex) : normalized;

    const cwDataInfo = this.getCwDataInfo(afterFrontmatter);
    const body = cwDataInfo
      ? `${afterFrontmatter.slice(0, cwDataInfo.startIndex)}${afterFrontmatter.slice(cwDataInfo.endIndex)}`
      : afterFrontmatter;

    const cwDataObj = this.parseCwDataObject(cwDataInfo?.body ?? null);
    const color = this.normalizeHexColor(cwDataObj?.color);
    const isPinned = cwDataObj?.ispinned === true;

    return {
      frontmatterBody,
      cwDataBody: cwDataInfo?.body ?? null,
      body: body.replace(/^\n+/, ""),
      color,
      isPinned,
    };
  }

  private composeContent(frontmatterBody: string | null, cwDataBody: string | null, body: string): string {
    const chunks: string[] = [];
    if (frontmatterBody && frontmatterBody.trim().length > 0) {
      chunks.push(`---\n${frontmatterBody.replace(/\n+$/g, "")}\n---`);
    }
    if (cwDataBody && cwDataBody.trim().length > 0) {
      chunks.push(`<!---cw-data\n${cwDataBody.replace(/\n+$/g, "")}\n--->`);
    }
    chunks.push(body.replace(/^\n+/, ""));
    return chunks.join("\n\n");
  }

  private upsertCwDataColor(cwDataBody: string | null, hex: string): string {
    const obj = this.parseCwDataObject(cwDataBody) ?? {};
    const normalized: Record<string, unknown> = {
      warning: InspirationView.CW_DATA_WARNING,
      color: hex.toUpperCase(),
      ispinned: typeof obj.ispinned === "boolean" ? obj.ispinned : false,
    };
    return JSON.stringify(normalized, null, 2);
  }

  private upsertCwDataPinned(cwDataBody: string | null, pinned: boolean): string {
    const obj = this.parseCwDataObject(cwDataBody) ?? {};
    const normalized: Record<string, unknown> = {
      warning: InspirationView.CW_DATA_WARNING,
      ispinned: pinned,
    };
    const existingColor = this.normalizeHexColor(obj.color);
    if (existingColor) {
      normalized.color = existingColor;
    }
    return JSON.stringify(normalized, null, 2);
  }

  private parseCwDataObject(cwDataBody: string | null): Record<string, any> | null {
    const normalized = (cwDataBody ?? "").trim();
    if (!normalized) return null;
    const safe = normalized.replace(/("color"\s*:\s*)(#[0-9a-fA-F]{6})/g, '$1"$2"');
    try {
      const parsed = JSON.parse(safe);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  private normalizeHexColor(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null;
  }

  private getFrontmatterInfo(content: string): { body: string; endIndex: number } | null {
    if (!content.startsWith("---\n")) return null;
    const endIndex = content.indexOf("\n---\n", 4);
    if (endIndex === -1) return null;
    const body = content.slice(4, endIndex);
    return { body, endIndex: endIndex + 5 };
  }

  private getCwDataInfo(content: string): { body: string; startIndex: number; endIndex: number } | null {
    const regex = /<!---cw-data\s*\n([\s\S]*?)\n--->/m;
    const match = regex.exec(content);
    if (!match || match.index < 0) return null;
    return {
      body: match[1] ?? "",
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    };
  }

  private applyCardColor(itemEl: HTMLElement, hex: string | null): void {
    if (!hex) {
      itemEl.removeClass("has-custom-color");
      itemEl.style.removeProperty("--cw-inspiration-card-color");
      itemEl.style.removeProperty("--cw-inspiration-card-color-bg");
      return;
    }
    itemEl.addClass("has-custom-color");
    itemEl.style.setProperty("--cw-inspiration-card-color", hex);
    itemEl.style.setProperty("--cw-inspiration-card-color-bg", this.hexToRgba(hex, 0.25));
  }

  private hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "transparent";
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
