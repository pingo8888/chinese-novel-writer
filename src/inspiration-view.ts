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
} from "obsidian";
import type ChineseWriterPlugin from "./main";
import { ConfirmModal } from "./modals";

export const VIEW_TYPE_INSPIRATION = "chinese-writer-inspiration-view";

type SortMode = "ctime-asc" | "ctime-desc" | "mtime-asc" | "mtime-desc";

interface ParsedCardContent {
  frontmatterBody: string | null;
  cwDataBody: string | null;
  body: string;
  tagsLine: string;
  images: string[];
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
  private expandedImageCards: Set<string> = new Set();
  private imageLightboxEl: HTMLElement | null = null;

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
    this.closeImageLightbox();
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
    const actionsEl = barEl.createDiv({ cls: "cw-inspiration-item-actions" });
    const pinnedBadgeEl = actionsEl.createDiv({ cls: "cw-inspiration-item-pin-badge is-hidden" });
    const pinnedBadgeIconEl = pinnedBadgeEl.createSpan({ cls: "cw-inspiration-item-pin-badge-icon" });
    setIcon(pinnedBadgeIconEl, "pin");
    this.setPinnedBadgeVisible(pinnedBadgeEl, isPinned);
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
    let isImagesExpanded = this.expandedImageCards.has(file.path) || currentImages.length > 0;
    if (isImagesExpanded) {
      this.expandedImageCards.add(file.path);
    }
    setIcon(mediaToggleBtn, isImagesExpanded ? "chevron-up" : "chevron-down");
    mediaToggleBtn.setAttribute("aria-label", isImagesExpanded ? "隐藏图片区" : "显示图片区");
    imagesSectionEl.toggleClass("is-hidden", !isImagesExpanded);
    textareaEl.value = currentBody;
    tagsEditorEl.value = currentTagsLine;
    textareaEl.setAttribute("aria-label", `${file.basename} 编辑区`);
    tagsEditorEl.setAttribute("aria-label", `${file.basename} 标签编辑区`);
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
      await saveContent();
    };
    const handleRemoveImage = async (imagePath: string) => {
      const nextImages = currentImages.filter((p) => p !== imagePath);
      if (nextImages.length === currentImages.length) return;
      currentImages = nextImages;
      this.renderImageSection(imagesSectionEl, currentImages, handleAddImage, handleRemoveImage);
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
    const saveContent = async () => {
      const normalizedTags = this.normalizeTagLine(tagsEditorEl.value);
      if (normalizedTags !== tagsEditorEl.value) {
        tagsEditorEl.value = normalizedTags;
      }
      const nextCwData = this.upsertCwDataCardContent(cwDataBody, normalizedTags, currentImages);
      const nextComposed = this.composeContent(frontmatterBody, nextCwData, textareaEl.value);
      if (nextComposed === lastSavedContent) return;
      try {
        await this.app.vault.modify(file, nextComposed);
        lastSavedContent = nextComposed;
        cwDataBody = nextCwData;
        currentBody = textareaEl.value;
        currentTagsLine = normalizedTags;
        await this.renderPreview(previewEl, currentBody, file.path);
        await this.renderTagPreview(tagsPreviewEl, currentTagsLine, file.path);
        this.renderImageSection(imagesSectionEl, currentImages, handleAddImage, handleRemoveImage);
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
            this.setPinnedBadgeVisible(pinnedBadgeEl, isPinned);
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
    });
    tagsEditorEl.addEventListener("focus", () => {
      this.setTagEditorExpanded(tagsEditorEl);
    });
    tagsEditorEl.addEventListener("blur", () => {
      tagsPreviewEl.removeClass("is-hidden");
      tagsEditorEl.addClass("is-hidden");
      this.setTagEditorExpanded(tagsEditorEl);
      void saveContent();
    });
    tagsEditorEl.addEventListener("keydown", (evt) => {
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "s") {
        evt.preventDefault();
        evt.stopPropagation();
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
      isImagesExpanded = !isImagesExpanded;
      imagesSectionEl.toggleClass("is-hidden", !isImagesExpanded);
      if (isImagesExpanded) {
        this.expandedImageCards.add(file.path);
      } else {
        this.expandedImageCards.delete(file.path);
      }
      setIcon(mediaToggleBtn, isImagesExpanded ? "chevron-up" : "chevron-down");
      mediaToggleBtn.setAttribute("aria-label", isImagesExpanded ? "隐藏图片区" : "显示图片区");
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

  private async renderTagPreview(previewEl: HTMLElement, tagsLine: string, sourcePath: string): Promise<void> {
    void sourcePath;
    previewEl.empty();
    const tokens = this.extractTagTokens(tagsLine);
    if (tokens.length === 0) {
      previewEl.createEl("p", { text: "点击添加标签（示例： #角色/主角 #世界观）" });
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
    const imageFiles = this.app.vault
      .getFiles()
      .filter((file) => this.isSupportedImageFile(file))
      .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
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
    const bodyWithTags = cwDataInfo
      ? `${afterFrontmatter.slice(0, cwDataInfo.startIndex)}${afterFrontmatter.slice(cwDataInfo.endIndex)}`
      : afterFrontmatter;
    const cwDataObj = this.parseCwDataObject(cwDataInfo?.body ?? null);
    const cwTagsLine = this.formatTagLineFromTokens(this.extractTagTokens(cwDataObj?.tags));
    const images = this.extractImagePaths(cwDataObj?.images);
    const color = this.normalizeHexColor(cwDataObj?.color);
    const isPinned = cwDataObj?.ispinned === true;

    return {
      frontmatterBody,
      cwDataBody: cwDataInfo?.body ?? null,
      body: bodyWithTags.replace(/^\n+/, ""),
      tagsLine: cwTagsLine,
      images,
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
    chunks.push(body.replace(/^\n+/, "").replace(/\n+$/g, ""));
    return chunks.join("\n\n");
  }

  private normalizeTagLine(value: string): string {
    return this.formatTagLineFromTokens(this.extractTagTokens(value));
  }

  private extractTagTokens(value: unknown): string[] {
    const rawItems: string[] = [];
    if (typeof value === "string") {
      rawItems.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          rawItems.push(item);
        }
      }
    }

    const tokens: string[] = [];
    const seen = new Set<string>();

    for (const raw of rawItems) {
      const directMatches = raw.match(/#[^\s,#]+/g);
      if (directMatches && directMatches.length > 0) {
        for (const match of directMatches) {
          const core = match.slice(1).trim();
          if (!core) continue;
          const normalized = `#${core}`;
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          tokens.push(normalized);
        }
        continue;
      }

      const segments = raw
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      for (const segment of segments) {
        const core = segment.startsWith("#") ? segment.slice(1).trim() : segment.trim();
        if (!core || /\s/.test(core)) continue;
        const normalized = `#${core}`;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        tokens.push(normalized);
      }
    }

    return tokens;
  }

  private formatTagLineFromTokens(tokens: string[]): string {
    return tokens.length > 0 ? ` ${tokens.join(" ")}` : "";
  }

  private formatTagCsvFromTokens(tokens: string[]): string | null {
    return tokens.length > 0 ? tokens.join(",") : null;
  }

  private extractImagePaths(value: unknown): string[] {
    const rawItems: string[] = [];
    if (typeof value === "string") {
      rawItems.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          rawItems.push(item);
        }
      }
    }
    const paths = rawItems
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return this.normalizeImagePaths(paths);
  }

  private normalizeImagePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawPath of paths) {
      const path = rawPath.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      normalized.push(path);
      if (normalized.length >= 8) break;
    }
    return normalized;
  }

  private formatImageCsv(paths: string[]): string | null {
    const normalized = this.normalizeImagePaths(paths);
    return normalized.length > 0 ? normalized.join(",") : null;
  }

  private getAvailableTagSuggestions(): string[] {
    const rawTags = (this.app.metadataCache as unknown as {
      getTags?: () => Record<string, unknown> | null | undefined;
    }).getTags?.();
    if (!rawTags) return [];
    return Object.keys(rawTags)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
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

  private upsertCwDataColor(cwDataBody: string | null, hex: string): string {
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
    return JSON.stringify(normalized, null, 2);
  }

  private upsertCwDataPinned(cwDataBody: string | null, pinned: boolean): string {
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
    return JSON.stringify(normalized, null, 2);
  }

  private upsertCwDataCardContent(cwDataBody: string | null, tagsLine: string, images: string[]): string {
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
