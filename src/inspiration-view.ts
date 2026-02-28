import {
  App,
  FuzzySuggestModal,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  TFile,
  TFolder,
  WorkspaceLeaf,
  setIcon,
  setTooltip,
} from "obsidian";
import type ChineseWriterPlugin from "./main";
import { ConfirmModal } from "./modals";
import { InspirationCardCodec, type ParsedCardContent } from "./inspiration-card-codec";

export const VIEW_TYPE_INSPIRATION = "chinese-writer-inspiration-view";

type SortMode = "ctime-asc" | "ctime-desc" | "mtime-asc" | "mtime-desc";

interface CardRenderModel extends ParsedCardContent {
  file: TFile;
}

interface ImageExpansionControl {
  hasImages: boolean;
  setExpanded: (expanded: boolean) => void;
}

export class InspirationView extends ItemView {
  plugin: ChineseWriterPlugin;
  private static readonly CW_DATA_WARNING = "数据由灵感便签管理，请勿删除或手动修改";
  private static readonly CARD_COLORS = [
    "#4A86E9",
    "#7B61FF",
    "#47B881",
    "#F6C445",
    "#F59E0B",
    "#F05D6C",
    "#9CA3AF",
  ];
  private sortMode: SortMode = "ctime-desc";
  private cardMenuEl: HTMLElement | null = null;
  private sortMenuEl: HTMLElement | null = null;
  private menuCleanup: Array<() => void> = [];
  private expandedImageCards: Set<string> = new Set();
  private listImageExpansionControls: Map<string, ImageExpansionControl> = new Map();
  private floatingImageExpansionControls: Map<string, ImageExpansionControl> = new Map();
  private imageLightboxEl: HTMLElement | null = null;
  private searchQuery = "";
  private cardModels: CardRenderModel[] = [];
  private listEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private searchCountEl: HTMLElement | null = null;
  private renderPassId = 0;
  private floatingPanelEls: HTMLElement[] = [];
  private floatingPanelCleanup: Array<() => void> = [];
  private floatingStartPosByPath: Map<string, { left: number; top: number; width: number; height: number }> = new Map();
  private pendingEditorFocusPath: string | null = null;
  private cachedImageFiles: TFile[] | null = null;
  private imageCacheListenersRegistered = false;
  private readonly cardCodec = new InspirationCardCodec();
  private static readonly FLOATING_MIN_WIDTH = 280;
  private static readonly FLOATING_MIN_BODY_HEIGHT = 40;
  private static readonly DEFAULT_FLOATING_WIDTH = 280;

  constructor(leaf: WorkspaceLeaf, plugin: ChineseWriterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_INSPIRATION;
  }

  getDisplayText(): string {
    return "灵感便签";
  }

  getIcon(): string {
    return "lightbulb";
  }

  async onOpen(): Promise<void> {
    this.ensureImageCacheListeners();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.closeMenus();
    this.closeImageLightbox();
    this.clearFloatingPanels();
    this.cachedImageFiles = null;
  }

  async refresh(): Promise<void> {
    const container = this.containerEl.children[1];
    if (!container) return;
    this.renderPassId += 1;
    this.cardModels = [];
    this.listEl = null;
    this.emptyEl = null;
    this.searchCountEl = null;
    container.empty();
    this.listImageExpansionControls.clear();
    this.floatingImageExpansionControls.clear();
    this.clearFloatingPanels();
    container.addClass("chinese-writer-view");

    const headerEl = container.createDiv({ cls: "chinese-writer-header" });
    const titleEl = headerEl.createDiv({ cls: "chinese-writer-title" });
    const iconEl = titleEl.createSpan({ cls: "chinese-writer-icon" });
    setIcon(iconEl, "lightbulb");
    titleEl.createSpan({ text: "灵感便签", cls: "chinese-writer-folder-name" });
    const createBtn = headerEl.createEl("button", {
      cls: "chinese-writer-toggle-btn cw-inspiration-create-btn",
      attr: { type: "button", "aria-label": "新建灵感便签" },
    });
    setIcon(createBtn, "sparkles");
    createBtn.addEventListener("click", () => {
      void this.createInspirationCard();
    });

    const contentEl = container.createDiv({ cls: "cw-inspiration-content" });
    const configuredPath = this.plugin.settings.inspirationFolderPath.trim();
    if (!configuredPath) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "未设置灵感便签路径，请到 设置 -> 其他功能 -> 其他便捷功能 中填写。",
      });
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(configuredPath);
    if (!(folder instanceof TFolder)) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "灵感便签路径无效，请填写 Vault 内目录路径。",
      });
      return;
    }

    const files = this.plugin.parser
      .getMarkdownFilesInFolder(configuredPath)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    if (files.length === 0) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "该目录下暂无灵感便签文件。",
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
    this.cardModels = cardModels;

    const searchBarEl = contentEl.createDiv({ cls: "cw-inspiration-search" });
    const searchFieldEl = searchBarEl.createDiv({ cls: "cw-inspiration-search-field" });
    const searchInputEl = searchFieldEl.createEl("input", {
      cls: "cw-inspiration-search-input",
      attr: {
        type: "search",
        placeholder: "搜索正文或 #标签",
        "aria-label": "搜索灵感便签",
      },
    });
    this.searchCountEl = searchFieldEl.createSpan({
      cls: "cw-inspiration-search-count",
      text: "0",
    });
    searchInputEl.value = this.searchQuery;
    const clearSearchBtn = searchBarEl.createEl("button", {
      cls: "cw-inspiration-search-clear",
      attr: { type: "button", "aria-label": "清空搜索" },
    });
    setIcon(clearSearchBtn, "brush-cleaning");
    if (!clearSearchBtn.querySelector("svg")) {
      clearSearchBtn.setText("×");
    }
    const sortBtn = searchBarEl.createEl("button", { cls: "chinese-writer-toggle-btn" });
    setIcon(sortBtn, this.getSortButtonIcon(this.sortMode));
    sortBtn.setAttribute("aria-label", "排序");
    sortBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.openSortMenu(sortBtn);
    });
    this.listEl = contentEl.createDiv({ cls: "cw-inspiration-list" });
    this.emptyEl = contentEl.createEl("p", {
      cls: "setting-item-description cw-inspiration-search-empty",
      text: "没有匹配的灵感便签。",
    });
    const updateSearchUi = () => {
      clearSearchBtn.hidden = this.searchQuery.length === 0;
    };
    searchInputEl.addEventListener("input", () => {
      this.searchQuery = searchInputEl.value.trim();
      updateSearchUi();
      void this.renderFilteredCards();
    });
    searchInputEl.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape") return;
      if (!this.searchQuery) return;
      evt.preventDefault();
      this.searchQuery = "";
      searchInputEl.value = "";
      updateSearchUi();
      void this.renderFilteredCards();
    });
    clearSearchBtn.addEventListener("click", () => {
      this.searchQuery = "";
      searchInputEl.value = "";
      updateSearchUi();
      void this.renderFilteredCards();
      searchInputEl.focus();
    });
    updateSearchUi();
    this.emptyEl.hidden = true;
    await this.renderFloatingCards(this.getFloatingModels(this.cardModels));
    await this.renderFilteredCards();
  }

  private getVisibleModels(models: CardRenderModel[]): CardRenderModel[] {
    return models.filter((model) => !model.isFloating);
  }

  private getFloatingModels(models: CardRenderModel[]): CardRenderModel[] {
    return models.filter((model) => model.isFloating);
  }

  private compareCards(a: CardRenderModel, b: CardRenderModel): number {
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

  private getSortedModels(models: CardRenderModel[]): CardRenderModel[] {
    return [...models].sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      return this.compareCards(a, b);
    });
  }

  private patchCardModel(filePath: string, patch: Partial<CardRenderModel>): void {
    const idx = this.cardModels.findIndex((model) => model.file.path === filePath);
    if (idx < 0) return;
    const target = this.cardModels[idx];
    if (!target) return;
    Object.assign(target, patch);
  }

  private filterModelsBySearch(models: CardRenderModel[], query: string): CardRenderModel[] {
    const tokens = query
      .toLowerCase()
      .split(/[\s\u3000]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (tokens.length === 0) return models;
    return models.filter((model) => {
      const body = model.body.toLowerCase();
      const tags = model.tagsLine.toLowerCase();
      return tokens.every((token) => body.includes(token) || tags.includes(token));
    });
  }

  private async renderFilteredCards(animateFilePath?: string): Promise<void> {
    if (!this.listEl || !this.emptyEl) return;
    const passId = ++this.renderPassId;
    this.listImageExpansionControls.clear();
    this.listEl.empty();
    const visibleModels = this.getVisibleModels(this.cardModels);
    const filteredModels = this.filterModelsBySearch(visibleModels, this.searchQuery);
    const sortedModels = this.getSortedModels(filteredModels);
    if (this.searchCountEl) {
      this.searchCountEl.setText(String(sortedModels.length));
    }
    this.emptyEl.hidden = sortedModels.length > 0;
    for (const model of sortedModels) {
      if (passId !== this.renderPassId) return;
      const itemEl = await this.renderFileItem(this.listEl, model);
      if (passId !== this.renderPassId) return;
      if (animateFilePath && model.file.path === animateFilePath) {
        itemEl.addClass("is-new");
        window.setTimeout(() => itemEl.removeClass("is-new"), 520);
      }
    }
  }

  private async insertCreatedCard(createdModel: CardRenderModel): Promise<void> {
    if (!this.listEl || !this.emptyEl) {
      await this.refresh();
      return;
    }
    const visibleModels = this.getVisibleModels(this.cardModels);
    const filteredModels = this.filterModelsBySearch(visibleModels, this.searchQuery);
    const sortedModels = this.getSortedModels(filteredModels);
    if (this.searchCountEl) {
      this.searchCountEl.setText(String(sortedModels.length));
    }
    this.emptyEl.hidden = sortedModels.length > 0;
    const insertIndex = sortedModels.findIndex((model) => model.file.path === createdModel.file.path);
    if (insertIndex < 0) {
      return;
    }
    const existingEl = this.listEl.querySelector<HTMLElement>(`.cw-inspiration-item[data-file-path="${CSS.escape(createdModel.file.path)}"]`);
    if (existingEl) {
      existingEl.remove();
    }
    const tempContainer = document.createElement("div");
    const itemEl = await this.renderFileItem(tempContainer, createdModel);
    const target = this.listEl.children.item(insertIndex);
    if (target) {
      this.listEl.insertBefore(itemEl, target);
    } else {
      this.listEl.appendChild(itemEl);
    }
    itemEl.addClass("is-new");
    window.setTimeout(() => itemEl.removeClass("is-new"), 520);
  }

  private clearFloatingPanels(): void {
    while (this.floatingPanelCleanup.length > 0) {
      const dispose = this.floatingPanelCleanup.pop();
      if (dispose) dispose();
    }
    for (const panelEl of this.floatingPanelEls) {
      panelEl.remove();
    }
    this.floatingPanelEls = [];
  }

  private async renderFloatingCards(models: CardRenderModel[]): Promise<void> {
    if (models.length === 0) return;
    const hostDocument = document;
    const hostWindow = window;
    const sortedModels = this.getSortedModels(models);
    const firstCardEl = this.listEl?.querySelector<HTMLElement>(".cw-inspiration-item");
    const fallbackWidth = Math.max(
      280,
      Math.round(firstCardEl?.getBoundingClientRect().width ?? this.listEl?.getBoundingClientRect().width ?? 360)
    );
    const viewRect = this.containerEl.getBoundingClientRect();
    for (const [index, model] of sortedModels.entries()) {
      const panelEl = hostDocument.body.createDiv({ cls: "cw-inspiration-floating-panel" });
      const pointerPreset = this.floatingStartPosByPath.get(model.file.path);
      if (pointerPreset) {
        this.floatingStartPosByPath.delete(model.file.path);
      }
      const panelWidth = Math.max(
        InspirationView.FLOATING_MIN_WIDTH,
        Math.round(pointerPreset?.width ?? model.floatingWidth ?? fallbackWidth)
      );
      panelEl.style.width = `${panelWidth}px`;
      this.floatingPanelEls.push(panelEl);

      const itemEl = await this.renderFileItem(panelEl, model);
      const dragHandle = itemEl.querySelector<HTMLElement>(".cw-inspiration-item-bar");
      if (!dragHandle) continue;
      const fallbackBodyHeight = Math.max(
        InspirationView.FLOATING_MIN_BODY_HEIGHT,
        Math.round(
          itemEl.querySelector<HTMLElement>(".cw-inspiration-item-preview")?.getBoundingClientRect().height ?? 220
        )
      );
      const bodyHeight = Math.max(
        InspirationView.FLOATING_MIN_BODY_HEIGHT,
        Math.round(pointerPreset?.height ?? model.floatingHeight ?? fallbackBodyHeight)
      );
      this.setFloatingBodyHeight(itemEl, bodyHeight);
      const resizeHandle = panelEl.createDiv({ cls: "cw-inspiration-floating-resize-handle" });

      let dragging = false;
      let resizing = false;
      let offsetX = 0;
      let offsetY = 0;
      let resizeStartX = 0;
      let resizeStartY = 0;
      let resizeStartWidth = 0;
      let resizeStartBodyHeight = 0;

      const clampWithinViewport = (left: number, top: number) => {
        const rect = panelEl.getBoundingClientRect();
        const margin = 8;
        const maxLeft = Math.max(margin, hostWindow.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, hostWindow.innerHeight - rect.height - margin);
        panelEl.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`;
        panelEl.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`;
      };
      const defaultLeft = Math.round((viewRect.left || 24) - panelWidth - 12);
      const defaultTop = Math.round((viewRect.top || 84) + index * 20);
      clampWithinViewport(
        pointerPreset?.left ?? model.floatingX ?? defaultLeft,
        pointerPreset?.top ?? model.floatingY ?? defaultTop
      );

      const onPointerMove = (evt: PointerEvent) => {
        if (dragging) {
          clampWithinViewport(evt.clientX - offsetX, evt.clientY - offsetY);
          return;
        }
        if (!resizing) return;
        const rect = panelEl.getBoundingClientRect();
        const margin = 8;
        const minWidth = InspirationView.FLOATING_MIN_WIDTH;
        const minBodyHeight = InspirationView.FLOATING_MIN_BODY_HEIGHT;
        const maxWidth = hostWindow.innerWidth - rect.left - margin;
        const nextWidth = Math.min(
          Math.max(minWidth, resizeStartWidth + (evt.clientX - resizeStartX)),
          Math.max(minWidth, Math.round(maxWidth))
        );
        const nextBodyHeight = Math.max(minBodyHeight, resizeStartBodyHeight + (evt.clientY - resizeStartY));
        panelEl.style.width = `${Math.round(nextWidth)}px`;
        this.setFloatingBodyHeight(itemEl, Math.round(nextBodyHeight));
        clampWithinViewport(rect.left, rect.top);
      };
      const onPointerUp = () => {
        if (dragging || resizing) {
          const rect = panelEl.getBoundingClientRect();
          const left = Math.round(rect.left);
          const top = Math.round(rect.top);
          const width = Math.round(rect.width);
          const height = this.getFloatingBodyHeight(itemEl);
          this.floatingStartPosByPath.set(model.file.path, { left, top, width, height });
          void this.persistFloatingGeometry(model.file.path, left, top, width, height);
        }
        dragging = false;
        resizing = false;
      };
      const onWindowResize = () => {
        const rect = panelEl.getBoundingClientRect();
        clampWithinViewport(rect.left, rect.top);
      };
      const onPointerDown = (evt: PointerEvent) => {
        const target = evt.target as HTMLElement | null;
        if (!target) return;
        if (target.closest("button, textarea, input, a")) return;
        if (evt.button !== 0) return;
        const rect = panelEl.getBoundingClientRect();
        offsetX = evt.clientX - rect.left;
        offsetY = evt.clientY - rect.top;
        dragging = true;
        evt.preventDefault();
      };
      const onResizePointerDown = (evt: PointerEvent) => {
        if (evt.button !== 0) return;
        const rect = panelEl.getBoundingClientRect();
        resizeStartX = evt.clientX;
        resizeStartY = evt.clientY;
        resizeStartWidth = rect.width;
        resizeStartBodyHeight = this.getFloatingBodyHeight(itemEl);
        resizing = true;
        evt.preventDefault();
        evt.stopPropagation();
      };

      dragHandle.addEventListener("pointerdown", onPointerDown);
      resizeHandle.addEventListener("pointerdown", onResizePointerDown);
      hostWindow.addEventListener("pointermove", onPointerMove);
      hostWindow.addEventListener("pointerup", onPointerUp);
      hostWindow.addEventListener("resize", onWindowResize);
      this.floatingPanelCleanup.push(() => {
        dragHandle.removeEventListener("pointerdown", onPointerDown);
        resizeHandle.removeEventListener("pointerdown", onResizePointerDown);
        hostWindow.removeEventListener("pointermove", onPointerMove);
        hostWindow.removeEventListener("pointerup", onPointerUp);
        hostWindow.removeEventListener("resize", onWindowResize);
      });
    }
  }

  async createCenteredFloatingCard(focusEditor = true): Promise<void> {
    const width = InspirationView.DEFAULT_FLOATING_WIDTH;
    const bodyHeight = this.getDefaultFloatingBodyHeight();
    const floatingGeometry = this.buildCenteredFloatingGeometry(width, bodyHeight);
    await this.createInspirationCard({ floatingGeometry, focusEditor });
  }

  private buildCenteredFloatingGeometry(
    width: number,
    bodyHeight: number
  ): { left: number; top: number; width: number; height: number } {
    const margin = 8;
    const normalizedWidth = Math.max(InspirationView.FLOATING_MIN_WIDTH, Math.round(width));
    const normalizedBodyHeight = Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(bodyHeight));
    // Estimate full panel height from body area + toolbar/tags/images controls.
    const estimatedPanelHeight = normalizedBodyHeight + 140;
    const centerLeft = Math.round((window.innerWidth - normalizedWidth) / 2);
    const centerTop = Math.round((window.innerHeight - estimatedPanelHeight) / 2);
    const maxLeft = Math.max(margin, window.innerWidth - normalizedWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - estimatedPanelHeight - margin);
    return {
      left: Math.min(Math.max(margin, centerLeft), maxLeft),
      top: Math.min(Math.max(margin, centerTop), maxTop),
      width: normalizedWidth,
      height: normalizedBodyHeight,
    };
  }

  private async createInspirationCard(options?: {
    floatingGeometry?: { left: number; top: number; width: number; height: number } | null;
    focusEditor?: boolean;
  }): Promise<void> {
    const configuredPath = this.plugin.settings.inspirationFolderPath.trim();
    if (!configuredPath) {
      new Notice("未设置灵感便签路径，请先在设置中填写。");
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(configuredPath);
    if (!(folder instanceof TFolder)) {
      new Notice("灵感便签路径无效，请填写 Vault 内目录路径。");
      return;
    }
    const filePath = this.buildUniqueInspirationFilePath(configuredPath, Date.now());
    this.plugin.suppressNextInspirationRefreshForPath(filePath);
    const floatingGeometry = options?.floatingGeometry ?? null;
    const cwDataObj: Record<string, unknown> = {
      warning: InspirationView.CW_DATA_WARNING,
      ispinned: false,
      color: this.pickRandomCardColor(),
    };
    if (floatingGeometry) {
      cwDataObj.isfloating = true;
      cwDataObj.floatx = floatingGeometry.left;
      cwDataObj.floaty = floatingGeometry.top;
      cwDataObj.floatw = floatingGeometry.width;
      cwDataObj.floath = floatingGeometry.height;
    }
    const cwDataBody = JSON.stringify(cwDataObj, null, 2);
    const content = this.composeContent(null, cwDataBody, "");
    try {
      const createdFile = await this.app.vault.create(filePath, content);
      const createdModel = { file: createdFile, ...this.parseCardContent(content) } as CardRenderModel;
      this.cardModels.push(createdModel);
      if (options?.focusEditor) {
        this.pendingEditorFocusPath = createdFile.path;
      }
      if (floatingGeometry) {
        this.clearFloatingPanels();
        await this.renderFloatingCards(this.getFloatingModels(this.cardModels));
      } else {
        await this.insertCreatedCard(createdModel);
      }
    } catch (error) {
      console.error("Failed to create inspiration card:", error);
      new Notice("新建灵感便签失败，请重试");
    }
  }

  private async modifyCardFile(file: TFile, content: string): Promise<void> {
    this.plugin.suppressNextInspirationRefreshForPath(file.path);
    await this.app.vault.modify(file, content);
  }

  private buildUniqueInspirationFilePath(folderPath: string, timestamp: number): string {
    const baseName = this.formatInspirationFileBaseName(timestamp);
    let candidate = `${folderPath}/${baseName}.md`;
    let idx = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${folderPath}/${baseName}-${idx}.md`;
      idx += 1;
    }
    return candidate;
  }

  private formatInspirationFileBaseName(timestamp: number): string {
    const date = new Date(timestamp);
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const shortId = Math.random().toString(36).slice(2, 6).padEnd(4, "0").toUpperCase();
    return `灵感-${year}${month}${day}-${hour}${minute}-${shortId}`;
  }

  private pickRandomCardColor(): string {
    const { CARD_COLORS } = InspirationView;
    const index = Math.floor(Math.random() * CARD_COLORS.length);
    return CARD_COLORS[index] ?? CARD_COLORS[0] ?? "#4A86E9";
  }

  private async renderFileItem(listEl: HTMLElement, model: CardRenderModel): Promise<HTMLElement> {
    const { file } = model;
    let frontmatterBody = model.frontmatterBody;
    let cwDataBody = model.cwDataBody;
    let isPinned = model.isPinned;
    let isFloating = model.isFloating;
    let currentColor = model.color;

    const itemEl = listEl.createDiv({ cls: "cw-inspiration-item" });
    itemEl.dataset.filePath = file.path;
    itemEl.style.setProperty("--cw-inspiration-lines", String(this.getCollapsedLines()));
    const barEl = itemEl.createDiv({ cls: "cw-inspiration-item-bar" });
    const metaEl = barEl.createDiv({ cls: "cw-inspiration-item-meta" });
    const pinnedBadgeEl = metaEl.createDiv({ cls: "cw-inspiration-item-pin-badge is-hidden" });
    const pinnedBadgeIconEl = pinnedBadgeEl.createSpan({ cls: "cw-inspiration-item-pin-badge-icon" });
    setIcon(pinnedBadgeIconEl, "pin");
    this.setPinnedBadgeVisible(pinnedBadgeEl, isPinned);
    const timeEl = barEl.createDiv({
      cls: "cw-inspiration-item-time",
      text: this.getCardTimeText(file),
    });
    metaEl.appendChild(timeEl);
    const actionsEl = barEl.createDiv({ cls: "cw-inspiration-item-actions" });
    const isInFloatingPanel = !!listEl.closest(".cw-inspiration-floating-panel");
    const floatBtn = actionsEl.createEl("button", {
      cls: "cw-inspiration-item-more cw-inspiration-item-float",
      attr: { type: "button", "aria-label": isFloating ? "收回到列表" : "悬浮便签" },
    });
    setIcon(floatBtn, "send-horizontal");
    setTooltip(floatBtn, isFloating ? "收回到列表" : "悬浮便签");
    floatBtn.toggleClass("is-mirrored", !isInFloatingPanel);
    floatBtn.toggleClass("is-active", isFloating);
    const moreBtn = actionsEl.createEl("button", {
      cls: "cw-inspiration-item-more",
      attr: { type: "button", "aria-label": "更多操作" },
    });
    setIcon(moreBtn, "ellipsis");

    const previewEl = itemEl.createDiv({ cls: "cw-inspiration-item-preview markdown-rendered" });
    const textareaEl = itemEl.createEl("textarea", { cls: "cw-inspiration-item-editor is-hidden" });
    const tagsRowEl = itemEl.createDiv({ cls: "cw-inspiration-item-tags-row" });
    const tagsContentEl = tagsRowEl.createDiv({ cls: "cw-inspiration-item-tags-content" });
    const tagsPreviewEl = tagsContentEl.createDiv({ cls: "cw-inspiration-item-tags-preview" });
    const tagsEditorEl = tagsContentEl.createEl("textarea", { cls: "cw-inspiration-item-tags-editor is-hidden" });
    const imagesSectionEl = itemEl.createDiv({ cls: "cw-inspiration-item-images is-hidden" });
    const mediaToggleBtn = tagsRowEl.createEl("button", {
      cls: "cw-inspiration-item-more cw-inspiration-item-media-toggle",
      attr: { type: "button", "aria-label": "显示图片区" },
    });
    let currentBody = model.body;
    let currentTagsLine = model.tagsLine;
    let currentImages = [...model.images];
    let isImagesExpanded = this.expandedImageCards.has(file.path) ||
      (this.plugin.settings.inspirationAutoExpandImages && currentImages.length > 0);
    const setImagesExpanded = (expanded: boolean) => {
      isImagesExpanded = expanded;
      imagesSectionEl.toggleClass("is-hidden", !isImagesExpanded);
      setIcon(mediaToggleBtn, isImagesExpanded ? "chevron-up" : "chevron-down");
      mediaToggleBtn.setAttribute("aria-label", isImagesExpanded ? "隐藏图片区" : "显示图片区");
      if (isImagesExpanded) {
        this.expandedImageCards.add(file.path);
      } else {
        this.expandedImageCards.delete(file.path);
      }
      const control = this.getImageExpansionControl(file.path);
      if (control) {
        control.hasImages = currentImages.length > 0;
      }
    };
    setImagesExpanded(isImagesExpanded);
    const imageControlMap = isInFloatingPanel ? this.floatingImageExpansionControls : this.listImageExpansionControls;
    imageControlMap.set(file.path, {
      hasImages: currentImages.length > 0,
      setExpanded: (expanded) => setImagesExpanded(expanded),
    });
    textareaEl.value = currentBody;
    tagsEditorEl.value = currentTagsLine;
    tagsEditorEl.setAttribute("rows", "1");
    const handleAddImage = async () => {
      const selectedImage = await this.openImagePickerModal();
      if (!selectedImage) return;
      const imagePath = selectedImage.path;
      if (currentImages.includes(imagePath)) {
        new Notice("该图片已添加");
        return;
      }
      if (currentImages.length >= 8) {
        new Notice("最多支持 8 张图片");
        return;
      }
      currentImages = [...currentImages, imagePath];
      this.renderImageSection(imagesSectionEl, currentImages, handleAddImage, handleRemoveImage);
      if (this.plugin.settings.inspirationAutoExpandImages) {
        setImagesExpanded(true);
      }
      await saveContent();
    };
    const handleRemoveImage = async (imagePath: string) => {
      const nextImages = currentImages.filter((p) => p !== imagePath);
      if (nextImages.length === currentImages.length) return;
      currentImages = nextImages;
      this.renderImageSection(imagesSectionEl, currentImages, handleAddImage, handleRemoveImage);
      if (!currentImages.length) {
        setImagesExpanded(false);
      }
      await saveContent();
    };
    await this.renderPreview(previewEl, currentBody, file.path);
    await this.renderTagPreview(tagsPreviewEl, currentTagsLine, file.path);
    this.renderImageSection(imagesSectionEl, currentImages, handleAddImage, handleRemoveImage);
    this.applyCardColor(itemEl, model.color);
    this.setEditorExpanded(textareaEl, false);
    this.setTagEditorExpanded(tagsEditorEl);
    this.bindTagSuggestionEditor(tagsEditorEl);

    let lastSavedContent = this.composeContent(frontmatterBody, cwDataBody, textareaEl.value);
    let saveRequestId = 0;
    let saveChain: Promise<void> = Promise.resolve();
    let saveDebounceTimer: number | null = null;
    const saveContent = async () => {
      const requestId = ++saveRequestId;
      saveChain = saveChain.then(async () => {
        if (requestId !== saveRequestId) return;
        const normalizedTags = this.normalizeTagLine(tagsEditorEl.value);
        const isTagEditorActive = document.activeElement === tagsEditorEl;
        if (!isTagEditorActive && normalizedTags !== tagsEditorEl.value) {
          tagsEditorEl.value = normalizedTags;
        }
        const nextCwData = this.upsertCwDataCardContent(cwDataBody, normalizedTags, currentImages, file.path);
        const nextComposed = this.composeContent(frontmatterBody, nextCwData, textareaEl.value);
        if (nextComposed === lastSavedContent) return;
        try {
          await this.modifyCardFile(file, nextComposed);
          lastSavedContent = nextComposed;
          cwDataBody = nextCwData;
          currentBody = textareaEl.value;
          currentTagsLine = normalizedTags;
          this.patchCardModel(file.path, {
            frontmatterBody,
            cwDataBody: nextCwData,
            body: currentBody,
            tagsLine: currentTagsLine,
            images: [...currentImages],
          });
          await this.renderPreview(previewEl, currentBody, file.path);
          await this.renderTagPreview(tagsPreviewEl, currentTagsLine, file.path);
          this.renderImageSection(imagesSectionEl, currentImages, handleAddImage, handleRemoveImage);
          timeEl.setText(this.getCardTimeText(file, Date.now()));
        } catch (error) {
          console.error("Failed to save inspiration file:", error);
          new Notice("灵感便签保存失败，请重试");
        }
      });
      await saveChain;
    };
    const scheduleAutoSave = () => {
      if (saveDebounceTimer !== null) {
        window.clearTimeout(saveDebounceTimer);
      }
      saveDebounceTimer = window.setTimeout(() => {
        saveDebounceTimer = null;
        void saveContent();
      }, 300);
    };
    const flushAutoSave = () => {
      if (saveDebounceTimer !== null) {
        window.clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
      }
      void saveContent();
    };

    moreBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.openCardMenu(moreBtn, {
        pinned: isPinned,
        floating: isFloating,
        selectedColor: currentColor,
        onSelectColor: async (hex) => {
          const nextCwData = this.upsertCwDataColor(cwDataBody, hex, file.path);
          const updated = this.composeContent(frontmatterBody, nextCwData, textareaEl.value);
          if (updated === lastSavedContent) return;
          try {
            await this.modifyCardFile(file, updated);
            cwDataBody = nextCwData;
            lastSavedContent = updated;
            currentColor = hex.toUpperCase();
            this.patchCardModel(file.path, {
              cwDataBody: nextCwData,
              color: currentColor,
            });
            this.applyCardColor(itemEl, hex);
            timeEl.setText(this.getCardTimeText(file, Date.now()));
          } catch (error) {
            console.error("Failed to save inspiration card color:", error);
            new Notice("设置灵感便签颜色失败，请重试");
          }
        },
        onTogglePinned: async () => {
          const nextPinned = !isPinned;
          if (nextPinned) {
            const hasOtherPinned = this.cardModels.some(
              (entry) => entry.file.path !== file.path && entry.isPinned
            );
            if (hasOtherPinned) {
              new Notice("已有其他灵感便签置顶");
              return;
            }
          }
          const nextCwData = this.upsertCwDataPinned(cwDataBody, nextPinned, file.path);
          const updated = this.composeContent(frontmatterBody, nextCwData, textareaEl.value);
          if (updated === lastSavedContent) return;
          try {
            await this.modifyCardFile(file, updated);
            cwDataBody = nextCwData;
            isPinned = nextPinned;
            this.setPinnedBadgeVisible(pinnedBadgeEl, isPinned);
            lastSavedContent = updated;
            this.patchCardModel(file.path, {
              cwDataBody: nextCwData,
              isPinned: nextPinned,
            });
            await this.renderFilteredCards();
          } catch (error) {
            console.error("Failed to save pin state:", error);
            new Notice("置顶设置失败，请重试");
          }
        },
        onDelete: async () => {
          const modal = new ConfirmModal(
            this.app,
            "删除灵感便签",
            "确定要删除该灵感便签吗？此操作不可恢复。",
            () => {
              void (async () => {
                try {
                  await this.app.vault.trash(file, true);
                  this.cardModels = this.cardModels.filter((entry) => entry.file.path !== file.path);
                  itemEl.remove();
                  const visibleModels = this.getVisibleModels(this.cardModels);
                  const filteredModels = this.filterModelsBySearch(visibleModels, this.searchQuery);
                  const sortedModels = this.getSortedModels(filteredModels);
                  if (this.searchCountEl) {
                    this.searchCountEl.setText(String(sortedModels.length));
                  }
                  if (this.emptyEl) {
                    this.emptyEl.hidden = sortedModels.length > 0;
                  }
                } catch (error) {
                  console.error("Failed to delete inspiration file:", error);
                  new Notice("删除灵感便签失败，请重试");
                }
              })();
            }
          );
          modal.open();
        },
      });
    });
    floatBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void (async () => {
        const nextFloating = !isFloating;
        let floatingGeometry: { left: number; top: number; width: number; height: number } | null = null;
        if (nextFloating) {
          const rect = itemEl.getBoundingClientRect();
          floatingGeometry = {
            left: Math.round(rect.left - rect.width - 12),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: this.getFloatingBodyHeight(itemEl),
          };
        }
        let nextCwData = this.upsertCwDataFloating(cwDataBody, nextFloating, file.path, floatingGeometry);
        const shouldAutoUnpin = nextFloating && isPinned;
        if (shouldAutoUnpin) {
          nextCwData = this.upsertCwDataPinned(nextCwData, false, file.path);
        }
        const updated = this.composeContent(frontmatterBody, nextCwData, textareaEl.value);
        if (updated === lastSavedContent) return;
        try {
          if (nextFloating) {
            this.floatingStartPosByPath.set(file.path, floatingGeometry ?? {
              left: 24,
              top: 84,
              width: 360,
              height: 220,
            });
          } else {
            this.floatingStartPosByPath.delete(file.path);
          }
          await this.modifyCardFile(file, updated);
          cwDataBody = nextCwData;
          isFloating = nextFloating;
          if (shouldAutoUnpin) {
            isPinned = false;
            this.setPinnedBadgeVisible(pinnedBadgeEl, false);
          }
          lastSavedContent = updated;
          floatBtn.toggleClass("is-active", isFloating);
          const floatTip = isFloating ? "收回到列表" : "悬浮便签";
          floatBtn.setAttribute("aria-label", floatTip);
          setTooltip(floatBtn, floatTip);
          if (!nextFloating) {
            this.plugin.flashInspirationTabIconIfHidden();
          }
          this.patchCardModel(file.path, {
            cwDataBody: nextCwData,
            isPinned: shouldAutoUnpin ? false : isPinned,
            isFloating: nextFloating,
            floatingX: nextFloating ? floatingGeometry?.left ?? null : null,
            floatingY: nextFloating ? floatingGeometry?.top ?? null : null,
            floatingWidth: nextFloating ? floatingGeometry?.width ?? null : null,
            floatingHeight: nextFloating ? floatingGeometry?.height ?? null : null,
          });
          await this.refresh();
        } catch (error) {
          console.error("Failed to set floating state:", error);
          new Notice("设置悬浮便签失败，请重试");
        }
      })();
    });

    textareaEl.addEventListener("input", () => {
      this.setEditorExpanded(textareaEl, document.activeElement === textareaEl);
      scheduleAutoSave();
    });
    textareaEl.addEventListener("focus", () => {
      this.setEditorExpanded(textareaEl, true);
    });
    textareaEl.addEventListener("blur", () => {
      this.setEditorExpanded(textareaEl, false);
      previewEl.removeClass("is-hidden");
      textareaEl.addClass("is-hidden");
      flushAutoSave();
    });
    textareaEl.addEventListener("keydown", (evt) => {
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "s") {
        evt.preventDefault();
        evt.stopPropagation();
        if (saveDebounceTimer !== null) {
          window.clearTimeout(saveDebounceTimer);
          saveDebounceTimer = null;
        }
        void saveContent();
      }
    });
    textareaEl.addEventListener("contextmenu", (evt) => {
      this.openBodyEditorContextMenu(evt, textareaEl);
    });

    previewEl.addEventListener("click", (evt) => {
      const cursor = this.resolveSourceCursorFromPreviewClick(previewEl, textareaEl.value, evt);
      previewEl.addClass("is-hidden");
      textareaEl.removeClass("is-hidden");
      textareaEl.focus();
      const nextCursor = cursor ?? textareaEl.value.length;
      textareaEl.setSelectionRange(nextCursor, nextCursor);
      this.setEditorExpanded(textareaEl, true);
    });

    tagsEditorEl.addEventListener("input", () => {
      this.setTagEditorExpanded(tagsEditorEl);
      scheduleAutoSave();
    });
    tagsEditorEl.addEventListener("focus", () => {
      this.setTagEditorExpanded(tagsEditorEl);
    });
    tagsEditorEl.addEventListener("blur", () => {
      tagsPreviewEl.removeClass("is-hidden");
      tagsEditorEl.addClass("is-hidden");
      this.setTagEditorExpanded(tagsEditorEl);
      flushAutoSave();
    });
    tagsEditorEl.addEventListener("keydown", (evt) => {
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "s") {
        evt.preventDefault();
        evt.stopPropagation();
        if (saveDebounceTimer !== null) {
          window.clearTimeout(saveDebounceTimer);
          saveDebounceTimer = null;
        }
        void saveContent();
      }
    });

    tagsPreviewEl.addEventListener("click", () => {
      tagsPreviewEl.addClass("is-hidden");
      tagsEditorEl.removeClass("is-hidden");
      tagsEditorEl.focus();
      tagsEditorEl.setSelectionRange(tagsEditorEl.value.length, tagsEditorEl.value.length);
      this.setTagEditorExpanded(tagsEditorEl);
    });
    mediaToggleBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      setImagesExpanded(!isImagesExpanded);
    });
    if (this.pendingEditorFocusPath === file.path) {
      this.pendingEditorFocusPath = null;
      previewEl.addClass("is-hidden");
      textareaEl.removeClass("is-hidden");
      textareaEl.focus();
      const caret = textareaEl.value.length;
      textareaEl.setSelectionRange(caret, caret);
      this.setEditorExpanded(textareaEl, true);
    }
    return itemEl;
  }

  applyImageAutoExpandSetting(enabled: boolean): void {
    for (const [filePath, control] of this.listImageExpansionControls) {
      const nextExpanded = enabled && control.hasImages;
      control.setExpanded(nextExpanded);
      if (nextExpanded) {
        this.expandedImageCards.add(filePath);
      } else {
        this.expandedImageCards.delete(filePath);
      }
    }
    for (const [filePath, control] of this.floatingImageExpansionControls) {
      const nextExpanded = enabled && control.hasImages;
      control.setExpanded(nextExpanded);
      if (nextExpanded) {
        this.expandedImageCards.add(filePath);
      } else {
        this.expandedImageCards.delete(filePath);
      }
    }
  }

  private async renderPreview(previewEl: HTMLElement, body: string, sourcePath: string): Promise<void> {
    previewEl.empty();
    const normalized = body.trim();
    if (!normalized) {
      previewEl.createEl("p", { text: "" });
      return;
    }
    await MarkdownRenderer.render(this.app, normalized, previewEl, sourcePath, this);
    previewEl.removeAttribute("aria-label");
    previewEl.removeAttribute("title");
  }

  private async renderTagPreview(previewEl: HTMLElement, tagsLine: string, sourcePath: string): Promise<void> {
    void sourcePath;
    previewEl.empty();
    const tokens = this.extractTagTokens(tagsLine);
    if (tokens.length === 0) {
      const hintText = this.plugin.settings.inspirationShowTagHint
        ? "点击添加标签（示例：#角色 #伏笔）"
        : "";
      previewEl.createEl("p", { text: hintText });
      previewEl.addClass("is-empty");
      return;
    }
    previewEl.removeClass("is-empty");
    const lineEl = previewEl.createDiv({ cls: "cw-inspiration-item-tags-line" });
    for (const token of tokens) {
      lineEl.createSpan({ cls: "cw-inspiration-item-tag-pill", text: token });
    }
  }

  private renderImageSection(
    sectionEl: HTMLElement,
    images: string[],
    onRequestAddImage: () => Promise<void>,
    onRequestRemoveImage: (imagePath: string) => Promise<void>
  ): void {
    sectionEl.empty();
    const gridEl = sectionEl.createDiv({ cls: "cw-inspiration-item-image-grid" });
    for (const imagePath of images) {
      const slotEl = gridEl.createDiv({ cls: "cw-inspiration-item-image-slot" });
      const removeBtn = slotEl.createEl("button", {
        cls: "cw-inspiration-item-image-remove",
        attr: { type: "button", "aria-label": "删除图片" },
      });
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        void onRequestRemoveImage(imagePath);
      });
      const abstractFile = this.app.vault.getAbstractFileByPath(imagePath);
      if (abstractFile instanceof TFile && this.isSupportedImageFile(abstractFile)) {
        const imgEl = slotEl.createEl("img", { cls: "cw-inspiration-item-image", attr: { alt: imagePath } });
        imgEl.src = this.app.vault.getResourcePath(abstractFile);
        imgEl.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.openImageLightbox(abstractFile);
        });
      } else {
        slotEl.addClass("is-missing");
        slotEl.setText("图片丢失");
      }
    }

    if (images.length < 8) {
      const addBtn = gridEl.createEl("button", {
        cls: "cw-inspiration-item-image-slot is-add",
        attr: { type: "button", "aria-label": "添加图片" },
      });
      addBtn.createSpan({ cls: "cw-inspiration-item-image-add-plus", text: "+" });
      addBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        void onRequestAddImage();
      });
    }
  }

  private async openImagePickerModal(): Promise<TFile | null> {
    const imageFiles = this.getCachedImageFiles();
    if (imageFiles.length === 0) {
      new Notice("Vault 中未找到可用图片");
      return null;
    }
    return await new Promise<TFile | null>((resolve) => {
      const modal = new ImageFileSuggestModal(
        this.app,
        imageFiles,
        (file) => resolve(file),
        () => resolve(null)
      );
      modal.open();
    });
  }

  private isSupportedImageFile(file: TFile): boolean {
    const ext = file.extension.toLowerCase();
    return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp" || ext === "svg";
  }

  private getImageExpansionControl(filePath: string): ImageExpansionControl | undefined {
    return this.floatingImageExpansionControls.get(filePath) ?? this.listImageExpansionControls.get(filePath);
  }

  private ensureImageCacheListeners(): void {
    if (this.imageCacheListenersRegistered) return;
    this.imageCacheListenersRegistered = true;
    const invalidate = () => {
      this.cachedImageFiles = null;
    };
    this.registerEvent(this.app.vault.on("create", () => invalidate()));
    this.registerEvent(this.app.vault.on("delete", () => invalidate()));
    this.registerEvent(this.app.vault.on("rename", () => invalidate()));
  }

  private getCachedImageFiles(): TFile[] {
    if (!this.cachedImageFiles) {
      this.cachedImageFiles = this.app.vault
        .getFiles()
        .filter((file) => this.isSupportedImageFile(file))
        .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
    }
    return [...this.cachedImageFiles];
  }

  private openImageLightbox(file: TFile): void {
    this.closeImageLightbox();
    const overlayEl = document.createElement("div");
    overlayEl.className = "cw-inspiration-image-lightbox";
    const contentEl = overlayEl.createDiv({ cls: "cw-inspiration-image-lightbox-content" });
    const closeBtn = contentEl.createEl("button", {
      cls: "cw-inspiration-image-lightbox-close",
      attr: { type: "button", "aria-label": "关闭预览" },
    });
    setIcon(closeBtn, "x");
    const imgEl = contentEl.createEl("img", {
      cls: "cw-inspiration-image-lightbox-img",
      attr: { alt: file.path },
    });
    imgEl.src = this.app.vault.getResourcePath(file);

    const onClose = () => this.closeImageLightbox();
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        onClose();
      }
    };

    closeBtn.addEventListener("click", onClose);
    overlayEl.addEventListener("click", (evt) => {
      if (evt.target === overlayEl) {
        onClose();
      }
    });
    window.addEventListener("keydown", onKeyDown);
    overlayEl.dataset.keydownBound = "1";
    (overlayEl as unknown as { _cwOnKeyDown?: (evt: KeyboardEvent) => void })._cwOnKeyDown = onKeyDown;

    document.body.appendChild(overlayEl);
    this.imageLightboxEl = overlayEl;
  }

  private closeImageLightbox(): void {
    if (!this.imageLightboxEl) return;
    const keydownHandler = (this.imageLightboxEl as unknown as {
      _cwOnKeyDown?: (evt: KeyboardEvent) => void;
    })._cwOnKeyDown;
    if (keydownHandler) {
      window.removeEventListener("keydown", keydownHandler);
    }
    this.imageLightboxEl.remove();
    this.imageLightboxEl = null;
  }

  private setEditorExpanded(textareaEl: HTMLTextAreaElement, expanded: boolean): void {
    const floatingBodyHeight = this.resolveFloatingBodyHeightForEditor(textareaEl);
    if (floatingBodyHeight !== null) {
      textareaEl.style.maxHeight = `${floatingBodyHeight}px`;
      textareaEl.style.height = `${floatingBodyHeight}px`;
      return;
    }
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

  private setTagEditorExpanded(textareaEl: HTMLTextAreaElement): void {
    textareaEl.style.height = "0px";
    const minHeight = this.getTagEditorLineHeight(textareaEl);
    const nextHeight = Math.max(minHeight, textareaEl.scrollHeight);
    textareaEl.style.height = `${nextHeight}px`;
  }

  private getTagEditorLineHeight(textareaEl: HTMLTextAreaElement): number {
    const computed = window.getComputedStyle(textareaEl);
    const fontSize = Number.parseFloat(computed.fontSize) || 16;
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.4;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    return lineHeight + paddingTop + paddingBottom;
  }

  private getCollapsedLines(): number {
    const raw = this.plugin.settings.inspirationPreviewLines;
    const normalized = Number.isFinite(raw) ? Math.round(raw) : 3;
    return Math.min(10, Math.max(1, normalized));
  }

  private setFloatingBodyHeight(itemEl: HTMLElement, height: number): void {
    const normalized = Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(height));
    itemEl.style.setProperty("--cw-inspiration-floating-body-height", `${normalized}px`);
  }

  private getFloatingBodyHeight(itemEl: HTMLElement): number {
    const raw = itemEl.style.getPropertyValue("--cw-inspiration-floating-body-height").trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(parsed));
    }
    const previewEl = itemEl.querySelector<HTMLElement>(".cw-inspiration-item-preview");
    const fallback = previewEl?.getBoundingClientRect().height ?? 220;
    return Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(fallback));
  }

  private resolveFloatingBodyHeightForEditor(textareaEl: HTMLTextAreaElement): number | null {
    const itemEl = textareaEl.closest<HTMLElement>(".cw-inspiration-item");
    if (!itemEl) return null;
    const panelEl = itemEl.closest<HTMLElement>(".cw-inspiration-floating-panel");
    if (!panelEl) return null;
    return this.getFloatingBodyHeight(itemEl);
  }

  private getDefaultFloatingBodyHeight(): number {
    const host = this.containerEl?.children?.[1] ?? document.body;
    const probe = document.createElement("textarea");
    probe.className = "cw-inspiration-item-editor";
    probe.style.position = "fixed";
    probe.style.left = "-9999px";
    probe.style.top = "-9999px";
    probe.style.visibility = "hidden";
    host.appendChild(probe);
    const collapsed = this.getCollapsedMaxHeight(probe);
    probe.remove();
    return Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(collapsed));
  }

  private setPinnedBadgeVisible(badgeEl: HTMLElement, visible: boolean): void {
    badgeEl.toggleClass("is-hidden", !visible);
  }

  private resolveSourceCursorFromPreviewClick(
    previewEl: HTMLElement,
    sourceText: string,
    evt: MouseEvent
  ): number | null {
    const previewText = previewEl.textContent ?? "";
    if (!previewText) return null;

    const plainOffset = this.getPreviewTextOffsetFromPoint(previewEl, evt.clientX, evt.clientY);
    if (plainOffset === null) return null;

    const safeOffset = Math.max(0, Math.min(previewText.length, plainOffset));
    const exactPrefix = previewText.slice(0, safeOffset);
    if (exactPrefix.length > 0) {
      const exactIdx = sourceText.indexOf(exactPrefix);
      if (exactIdx >= 0) {
        return exactIdx + exactPrefix.length;
      }
    }

    const windowSizes = [16, 12, 8, 4];
    for (const size of windowSizes) {
      const start = Math.max(0, safeOffset - size);
      const end = Math.min(previewText.length, safeOffset + size);
      const prefix = previewText.slice(start, safeOffset);
      const suffix = previewText.slice(safeOffset, end);
      if (!prefix && !suffix) continue;

      const merged = `${prefix}${suffix}`;
      if (merged.length > 0) {
        const mergedIdx = sourceText.indexOf(merged);
        if (mergedIdx >= 0) {
          return mergedIdx + prefix.length;
        }
      }

      if (prefix.length > 0) {
        const prefixIdx = sourceText.lastIndexOf(prefix);
        if (prefixIdx >= 0) {
          return prefixIdx + prefix.length;
        }
      }

      if (suffix.length > 0) {
        const suffixIdx = sourceText.indexOf(suffix);
        if (suffixIdx >= 0) {
          return suffixIdx;
        }
      }
    }

    return null;
  }

  private getPreviewTextOffsetFromPoint(previewEl: HTMLElement, clientX: number, clientY: number): number | null {
    const position = this.getCaretPositionFromPoint(clientX, clientY);
    if (!position) return null;
    const { node, offset } = position;
    if (!previewEl.contains(node)) return null;

    const walker = document.createTreeWalker(previewEl, NodeFilter.SHOW_TEXT);
    let total = 0;
    let current: Node | null = walker.nextNode();
    while (current) {
      const text = current.textContent ?? "";
      if (current === node) {
        const localOffset = Math.max(0, Math.min(text.length, offset));
        return total + localOffset;
      }
      total += text.length;
      current = walker.nextNode();
    }
    return null;
  }

  private getCaretPositionFromPoint(clientX: number, clientY: number): { node: Node; offset: number } | null {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    if (typeof doc.caretPositionFromPoint === "function") {
      const pos = doc.caretPositionFromPoint(clientX, clientY);
      if (pos?.offsetNode) {
        return { node: pos.offsetNode, offset: pos.offset };
      }
    }
    if (typeof doc.caretRangeFromPoint === "function") {
      const range = doc.caretRangeFromPoint(clientX, clientY);
      if (range?.startContainer) {
        return { node: range.startContainer, offset: range.startOffset };
      }
    }
    return null;
  }

  private openBodyEditorContextMenu(evt: MouseEvent, textareaEl: HTMLTextAreaElement): void {
    evt.preventDefault();
    evt.stopPropagation();

    const hasSelection = (textareaEl.selectionEnd ?? 0) > (textareaEl.selectionStart ?? 0);
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("加粗")
        .setIcon("bold")
        .setDisabled(!hasSelection)
        .onClick(() => this.toggleInlineWrapper(textareaEl, "**", "**"))
    );
    menu.addItem((item) =>
      item
        .setTitle("倾斜")
        .setIcon("italic")
        .setDisabled(!hasSelection)
        .onClick(() => this.toggleInlineWrapper(textareaEl, "*", "*"))
    );
    menu.addItem((item) =>
      item
        .setTitle("删除线")
        .setIcon("strikethrough")
        .setDisabled(!hasSelection)
        .onClick(() => this.toggleInlineWrapper(textareaEl, "~~", "~~"))
    );
    menu.addItem((item) =>
      item
        .setTitle("高亮")
        .setIcon("highlighter")
        .setDisabled(!hasSelection)
        .onClick(() => this.toggleInlineWrapper(textareaEl, "==", "=="))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("清除格式")
        .setIcon("remove-formatting")
        .setDisabled(!hasSelection)
        .onClick(() => this.clearSelectionFormatting(textareaEl))
    );

    menu.showAtMouseEvent(evt);
  }

  private toggleInlineWrapper(textareaEl: HTMLTextAreaElement, prefix: string, suffix: string): void {
    const start = textareaEl.selectionStart ?? 0;
    const end = textareaEl.selectionEnd ?? 0;
    if (end <= start) return;
    const value = textareaEl.value;
    const selected = value.slice(start, end);

    // Case 1: selection already contains its own wrappers.
    if (
      selected.length >= prefix.length + suffix.length &&
      selected.startsWith(prefix) &&
      selected.endsWith(suffix)
    ) {
      const inner = selected.slice(prefix.length, selected.length - suffix.length);
      this.replaceRange(textareaEl, start, end, inner, start, start + inner.length);
      return;
    }

    // Case 2: wrappers are just outside current selection.
    const leftStart = start - prefix.length;
    const rightEnd = end + suffix.length;
    if (
      leftStart >= 0 &&
      rightEnd <= value.length &&
      value.slice(leftStart, start) === prefix &&
      value.slice(end, rightEnd) === suffix
    ) {
      this.replaceRange(textareaEl, leftStart, rightEnd, selected, leftStart, leftStart + selected.length);
      return;
    }

    // Default: apply wrapper.
    const wrapped = `${prefix}${selected}${suffix}`;
    this.replaceSelection(textareaEl, wrapped, start, start + wrapped.length);
  }

  private clearSelectionFormatting(textareaEl: HTMLTextAreaElement): void {
    const start = textareaEl.selectionStart ?? 0;
    const end = textareaEl.selectionEnd ?? 0;
    if (end <= start) return;
    const selected = textareaEl.value.slice(start, end);
    const next = this.stripInlineMarkdownFormatting(selected);
    this.replaceSelection(textareaEl, next, start, start + next.length);
  }

  private stripInlineMarkdownFormatting(input: string): string {
    let previous = "";
    let current = input;
    // Repeat until stable so nested formats are fully removed.
    while (current !== previous) {
      previous = current;
      current = current
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/(\*\*|__)([\s\S]*?)\1/g, "$2")
        .replace(/(~~)([\s\S]*?)\1/g, "$2")
        .replace(/(==)([\s\S]*?)\1/g, "$2")
        .replace(/(\*|_)([\s\S]*?)\1/g, "$2")
        .replace(/`([^`]+)`/g, "$1");
    }
    return current;
  }

  private replaceSelection(
    textareaEl: HTMLTextAreaElement,
    replacement: string,
    nextSelectionStart: number,
    nextSelectionEnd: number
  ): void {
    const start = textareaEl.selectionStart ?? 0;
    const end = textareaEl.selectionEnd ?? 0;
    const prefix = textareaEl.value.slice(0, start);
    const suffix = textareaEl.value.slice(end);
    textareaEl.value = `${prefix}${replacement}${suffix}`;
    textareaEl.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private replaceRange(
    textareaEl: HTMLTextAreaElement,
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    nextSelectionStart: number,
    nextSelectionEnd: number
  ): void {
    const prefix = textareaEl.value.slice(0, rangeStart);
    const suffix = textareaEl.value.slice(rangeEnd);
    textareaEl.value = `${prefix}${replacement}${suffix}`;
    textareaEl.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
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

  private getCardTimeText(file: TFile, mtimeFallbackMs?: number): string {
    const useCreateTime = this.sortMode === "ctime-asc" || this.sortMode === "ctime-desc";
    const ms = useCreateTime ? file.stat.ctime : (mtimeFallbackMs ?? file.stat.mtime);
    return this.formatTimestamp(ms);
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
      floating: boolean;
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
    if (handlers.floating) {
      pinEl.disabled = true;
      pinEl.addClass("is-disabled");
      pinEl.setAttribute("aria-label", "悬浮便签不支持置顶");
    }
    pinEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (handlers.floating) return;
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
      text: "删除灵感便签",
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
    return this.cardCodec.parseCardContent(content);
  }

  private composeContent(frontmatterBody: string | null, cwDataBody: string | null, body: string): string {
    return this.cardCodec.composeContent(frontmatterBody, cwDataBody, body);
  }

  private normalizeTagLine(value: string): string {
    return this.cardCodec.normalizeTagLine(value);
  }

  private extractTagTokens(value: unknown): string[] {
    return this.cardCodec.extractTagTokens(value);
  }

  private formatTagLineFromTokens(tokens: string[]): string {
    return this.cardCodec.formatTagLineFromTokens(tokens);
  }

  private formatTagCsvFromTokens(tokens: string[]): string | null {
    return this.cardCodec.formatTagCsvFromTokens(tokens);
  }

  private extractImagePaths(value: unknown): string[] {
    return this.cardCodec.extractImagePaths(value);
  }

  private formatImageCsv(paths: string[]): string | null {
    return this.cardCodec.formatImageCsv(paths);
  }

  private getAvailableTagSuggestions(): string[] {
    const combinedTags = new Set<string>();

    const rawTags = (this.app.metadataCache as unknown as {
      getTags?: () => Record<string, unknown> | null | undefined;
    }).getTags?.();
    if (rawTags) {
      for (const tag of Object.keys(rawTags)) {
        combinedTags.add(tag.startsWith("#") ? tag : `#${tag}`);
      }
    }

    for (const model of this.cardModels) {
      for (const tag of this.extractTagTokens(model.tagsLine)) {
        combinedTags.add(tag);
      }
    }

    return Array.from(combinedTags).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }

  private bindTagSuggestionEditor(editorEl: HTMLTextAreaElement): void {
    let suggestionContainer: HTMLElement | null = null;

    let filteredSuggestions: string[] = [];
    let activeSuggestionIndex = -1;

    const ensureSuggestionContainer = (): HTMLElement => {
      if (suggestionContainer) return suggestionContainer;
      suggestionContainer = document.createElement("div");
      suggestionContainer.classList.add(
        "cw-suggestion-container",
        "cw-suggestion-container-floating",
        "cw-inspiration-tag-suggestion-container"
      );
      document.body.appendChild(suggestionContainer);
      suggestionContainer.hidden = true;
      return suggestionContainer;
    };

    const cleanupSuggestionContainer = () => {
      if (!suggestionContainer) return;
      suggestionContainer.remove();
      suggestionContainer = null;
      filteredSuggestions = [];
      activeSuggestionIndex = -1;
    };

    const hideSuggestions = () => {
      if (!suggestionContainer) return;
      suggestionContainer.hidden = true;
      suggestionContainer.empty();
      filteredSuggestions = [];
      activeSuggestionIndex = -1;
    };

    const updateSuggestionPosition = () => {
      const container = ensureSuggestionContainer();
      const rect = editorEl.getBoundingClientRect();
      container.style.left = `${Math.round(rect.left)}px`;
      container.style.top = `${Math.round(rect.bottom + 4)}px`;
      container.style.width = `${Math.round(rect.width)}px`;
    };

    const updateActiveSuggestion = () => {
      if (!suggestionContainer) return;
      const rows = Array.from(suggestionContainer.children) as HTMLElement[];
      rows.forEach((row, idx) => row.toggleClass("is-active", idx === activeSuggestionIndex));
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < rows.length) {
        rows[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });
      }
    };

    const getTagQuery = (): { start: number; end: number; query: string } | null => {
      const caret = editorEl.selectionStart ?? editorEl.value.length;
      const beforeCaret = editorEl.value.slice(0, caret);
      const hashIndex = beforeCaret.lastIndexOf("#");
      if (hashIndex < 0) return null;
      if (hashIndex > 0 && !/\s/.test(beforeCaret.charAt(hashIndex - 1))) {
        return null;
      }
      const tokenAfterHash = beforeCaret.slice(hashIndex + 1);
      if (/\s/.test(tokenAfterHash)) return null;
      const tail = editorEl.value.slice(caret);
      const tailMatch = /^[^\s#]*/.exec(tail);
      const tokenEnd = caret + (tailMatch?.[0]?.length ?? 0);
      return {
        start: hashIndex,
        end: tokenEnd,
        query: tokenAfterHash.toLowerCase(),
      };
    };

    const applySuggestion = (selectedTag: string): boolean => {
      const queryInfo = getTagQuery();
      if (!queryInfo) return false;
      const prefix = editorEl.value.slice(0, queryInfo.start);
      const suffix = editorEl.value.slice(queryInfo.end);
      const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
      const insertText = `${needsLeadingSpace ? " " : ""}${selectedTag}`;
      const needsTrailingSpace = suffix.length === 0 || !/^\s/.test(suffix);
      const nextValue = `${prefix}${insertText}${needsTrailingSpace ? " " : ""}${suffix}`;
      const nextCaret = (prefix + insertText + (needsTrailingSpace ? " " : "")).length;
      editorEl.value = nextValue;
      editorEl.setSelectionRange(nextCaret, nextCaret);
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      hideSuggestions();
      return true;
    };

    const renderSuggestions = () => {
      const queryInfo = getTagQuery();
      if (!queryInfo) {
        hideSuggestions();
        return;
      }
      const existingTagSet = new Set(this.extractTagTokens(editorEl.value));
      const suggestions = this.getAvailableTagSuggestions();
      filteredSuggestions = suggestions
        .filter((tag) => tag.slice(1).toLowerCase().includes(queryInfo.query))
        .filter((tag) => !existingTagSet.has(tag))
        .slice(0, 80);
      const container = ensureSuggestionContainer();
      container.empty();
      if (filteredSuggestions.length === 0) {
        hideSuggestions();
        return;
      }
      container.hidden = false;
      updateSuggestionPosition();
      activeSuggestionIndex = 0;
      filteredSuggestions.forEach((item, idx) => {
        const row = container.createDiv({ text: item, cls: "cw-suggestion-row" });
        row.addEventListener("mouseenter", () => {
          activeSuggestionIndex = idx;
          updateActiveSuggestion();
        });
        row.addEventListener("mousedown", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          activeSuggestionIndex = idx;
          applySuggestion(item);
          editorEl.focus();
        });
      });
      updateActiveSuggestion();
    };

    editorEl.addEventListener("focus", () => renderSuggestions());
    editorEl.addEventListener("input", () => renderSuggestions());
    editorEl.addEventListener("keydown", (evt: KeyboardEvent) => {
      const isVisible = !!suggestionContainer && !suggestionContainer.hidden;
      if (evt.key === "ArrowDown" && isVisible) {
        evt.preventDefault();
        if (filteredSuggestions.length > 0) {
          activeSuggestionIndex = (activeSuggestionIndex + 1 + filteredSuggestions.length) % filteredSuggestions.length;
          updateActiveSuggestion();
        }
      } else if (evt.key === "ArrowUp" && isVisible) {
        evt.preventDefault();
        if (filteredSuggestions.length > 0) {
          activeSuggestionIndex = activeSuggestionIndex <= 0 ? filteredSuggestions.length - 1 : activeSuggestionIndex - 1;
          updateActiveSuggestion();
        }
      } else if ((evt.key === "Enter" || evt.key === "Tab") && isVisible) {
        evt.preventDefault();
        const selected = filteredSuggestions[activeSuggestionIndex];
        if (selected) {
          applySuggestion(selected);
        }
      } else if (evt.key === "Escape" && isVisible) {
        evt.preventDefault();
        hideSuggestions();
      }
    });
    editorEl.addEventListener("blur", () => {
      window.setTimeout(() => {
        cleanupSuggestionContainer();
      }, 120);
    });
  }

  private upsertCwDataColor(cwDataBody: string | null, hex: string, filePath?: string): string {
    const obj = this.parseCwDataObject(cwDataBody) ?? {};
    const tagsCsv = this.formatTagCsvFromTokens(this.extractTagTokens(obj.tags));
    const imagesCsv = this.formatImageCsv(this.extractImagePaths(obj.images));
    const normalized: Record<string, unknown> = {
      warning: InspirationView.CW_DATA_WARNING,
      color: hex.toUpperCase(),
      ispinned: typeof obj.ispinned === "boolean" ? obj.ispinned : false,
    };
    if (tagsCsv) {
      normalized.tags = tagsCsv;
    }
    if (imagesCsv) {
      normalized.images = imagesCsv;
    }
    this.applyFloatingFields(normalized, obj, filePath);
    return JSON.stringify(normalized, null, 2);
  }

  private upsertCwDataPinned(cwDataBody: string | null, pinned: boolean, filePath?: string): string {
    const obj = this.parseCwDataObject(cwDataBody) ?? {};
    const tagsCsv = this.formatTagCsvFromTokens(this.extractTagTokens(obj.tags));
    const imagesCsv = this.formatImageCsv(this.extractImagePaths(obj.images));
    const normalized: Record<string, unknown> = {
      warning: InspirationView.CW_DATA_WARNING,
      ispinned: pinned,
    };
    const existingColor = this.normalizeHexColor(obj.color);
    if (existingColor) {
      normalized.color = existingColor;
    }
    if (tagsCsv) {
      normalized.tags = tagsCsv;
    }
    if (imagesCsv) {
      normalized.images = imagesCsv;
    }
    this.applyFloatingFields(normalized, obj, filePath);
    return JSON.stringify(normalized, null, 2);
  }

  private upsertCwDataCardContent(
    cwDataBody: string | null,
    tagsLine: string,
    images: string[],
    filePath?: string
  ): string {
    const obj = this.parseCwDataObject(cwDataBody) ?? {};
    const normalized: Record<string, unknown> = {
      warning: InspirationView.CW_DATA_WARNING,
      ispinned: typeof obj.ispinned === "boolean" ? obj.ispinned : false,
    };
    const existingColor = this.normalizeHexColor(obj.color);
    if (existingColor) {
      normalized.color = existingColor;
    }
    const tagsCsv = this.formatTagCsvFromTokens(this.extractTagTokens(tagsLine));
    if (tagsCsv) {
      normalized.tags = tagsCsv;
    }
    const imagesCsv = this.formatImageCsv(images);
    if (imagesCsv) {
      normalized.images = imagesCsv;
    }
    this.applyFloatingFields(normalized, obj, filePath);
    return JSON.stringify(normalized, null, 2);
  }

  private upsertCwDataFloating(
    cwDataBody: string | null,
    floating: boolean,
    filePath?: string,
    geometry?: { left: number; top: number; width: number; height: number } | null
  ): string {
    const obj = this.parseCwDataObject(cwDataBody) ?? {};
    const tagsCsv = this.formatTagCsvFromTokens(this.extractTagTokens(obj.tags));
    const imagesCsv = this.formatImageCsv(this.extractImagePaths(obj.images));
    const normalized: Record<string, unknown> = {
      warning: InspirationView.CW_DATA_WARNING,
      ispinned: typeof obj.ispinned === "boolean" ? obj.ispinned : false,
    };
    const existingColor = this.normalizeHexColor(obj.color);
    if (existingColor) {
      normalized.color = existingColor;
    }
    if (tagsCsv) {
      normalized.tags = tagsCsv;
    }
    if (imagesCsv) {
      normalized.images = imagesCsv;
    }
    if (floating) {
      normalized.isfloating = true;
      const resolved = geometry ?? this.resolveFloatingGeometry(obj, filePath);
      if (resolved) {
        normalized.floatx = resolved.left;
        normalized.floaty = resolved.top;
        normalized.floatw = resolved.width;
        normalized.floath = resolved.height;
      }
    }
    return JSON.stringify(normalized, null, 2);
  }

  private applyFloatingFields(
    normalized: Record<string, unknown>,
    obj: Record<string, unknown>,
    filePath?: string
  ): void {
    if (obj.isfloating !== true) return;
    normalized.isfloating = true;
    const resolved = this.resolveFloatingGeometry(obj, filePath);
    if (!resolved) return;
    normalized.floatx = resolved.left;
    normalized.floaty = resolved.top;
    normalized.floatw = resolved.width;
    normalized.floath = resolved.height;
  }

  private resolveFloatingGeometry(
    obj: Record<string, unknown>,
    filePath?: string
  ): { left: number; top: number; width: number; height: number } | null {
    const fromMemory = filePath ? this.floatingStartPosByPath.get(filePath) : null;
    if (fromMemory) {
      return {
        left: Math.round(fromMemory.left),
        top: Math.round(fromMemory.top),
        width: Math.max(InspirationView.FLOATING_MIN_WIDTH, Math.round(fromMemory.width)),
        height: Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(fromMemory.height)),
      };
    }
    const left = this.normalizeFiniteNumber(obj.floatx);
    const top = this.normalizeFiniteNumber(obj.floaty);
    const width = this.normalizeFiniteNumber(obj.floatw);
    const height = this.normalizeFiniteNumber(obj.floath);
    if (left === null || top === null || width === null || height === null) return null;
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.max(InspirationView.FLOATING_MIN_WIDTH, Math.round(width)),
      height: Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(height)),
    };
  }

  private async persistFloatingGeometry(
    filePath: string,
    left: number,
    top: number,
    width: number,
    height: number
  ): Promise<void> {
    const model = this.cardModels.find((entry) => entry.file.path === filePath);
    if (!model || !model.isFloating) return;
    const roundedLeft = Math.round(left);
    const roundedTop = Math.round(top);
    const roundedWidth = Math.max(InspirationView.FLOATING_MIN_WIDTH, Math.round(width));
    const roundedHeight = Math.max(InspirationView.FLOATING_MIN_BODY_HEIGHT, Math.round(height));
    if (
      model.floatingX === roundedLeft &&
      model.floatingY === roundedTop &&
      model.floatingWidth === roundedWidth &&
      model.floatingHeight === roundedHeight
    ) {
      return;
    }
    const nextCwData = this.upsertCwDataFloating(
      model.cwDataBody,
      true,
      filePath,
      { left: roundedLeft, top: roundedTop, width: roundedWidth, height: roundedHeight }
    );
    const updated = this.composeContent(model.frontmatterBody, nextCwData, model.body);
    await this.modifyCardFile(model.file, updated);
    this.patchCardModel(filePath, {
      cwDataBody: nextCwData,
      floatingX: roundedLeft,
      floatingY: roundedTop,
      floatingWidth: roundedWidth,
      floatingHeight: roundedHeight,
    });
  }

  private parseCwDataObject(cwDataBody: string | null): Record<string, any> | null {
    return this.cardCodec.parseCwDataObject(cwDataBody);
  }

  private normalizeHexColor(value: unknown): string | null {
    return this.cardCodec.normalizeHexColor(value);
  }

  private normalizeFiniteNumber(value: unknown): number | null {
    return this.cardCodec.normalizeFiniteNumber(value);
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

class ImageFileSuggestModal extends FuzzySuggestModal<TFile> {
  private readonly imageFiles: TFile[];
  private readonly onChoose: (file: TFile) => void;
  private readonly onCancel: () => void;
  private settled = false;

  constructor(app: App, imageFiles: TFile[], onChoose: (file: TFile) => void, onCancel: () => void) {
    super(app);
    this.imageFiles = imageFiles;
    this.onChoose = onChoose;
    this.onCancel = onCancel;
    this.setPlaceholder("选择图片（最多 8 张）");
  }

  getItems(): TFile[] {
    return this.imageFiles;
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.settled = true;
    this.onChoose(item);
    this.close();
  }

  onClose(): void {
    super.onClose();
    // FuzzySuggestModal may trigger close before choose callback in some paths.
    // Defer cancel to next task to let onChooseItem settle first.
    window.setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        this.onCancel();
      }
    }, 0);
  }
}
