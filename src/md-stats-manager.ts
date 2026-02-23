import { MarkdownView, TFile, setIcon } from "obsidian";
import { RangeSet, RangeSetBuilder, Transaction } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  gutter
} from "@codemirror/view";
import type ChineseWriterPlugin from "./main";

interface FileCharCacheEntry {
  mtime: number;
  size: number;
  count: number;
  version: number;
}

interface FolderStats {
  fileCount: number;
  charCount: number;
}

class CharMilestoneMarker extends GutterMarker {
  private text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cw-char-milestone-marker";
    el.textContent = this.text;
    return el;
  }
}

class HeadingLevelIconWidget extends WidgetType {
  private level: number;

  constructor(level: number) {
    super();
    this.level = level;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = `cw-heading-level-icon cw-heading-level-icon-${this.level} cw-heading-level-icon-overlay`;

    const iconEl = document.createElement("span");
    iconEl.className = "cw-heading-level-icon-svg";
    const preferredIcon = `heading-${this.level}`;
    setIcon(iconEl, preferredIcon);
    if (!iconEl.firstChild) {
      setIcon(iconEl, "heading");
    }
    wrapper.appendChild(iconEl);

    return wrapper;
  }
}

/**
 * Markdown 统计管理器
 * 负责目录统计渲染与状态栏字数统计。
 */
export class MdStatsManager {
  private plugin: ChineseWriterPlugin;
  private fileCharCache: Map<string, FileCharCacheEntry> = new Map();
  private pendingFileCharCount: Map<string, Promise<number>> = new Map();
  private folderStatsCache: Map<string, FolderStats> = new Map();
  private editorViewToMarkdownView: WeakMap<EditorView, MarkdownView> = new WeakMap();
  private fileCharCacheVersion = 0;
  private refreshTimer: number | null = null;
  private mutationObserver: MutationObserver | null = null;
  private observedExplorerRoot: HTMLElement | null = null;
  private statusBarEl: HTMLElement | null = null;
  private statusUpdateRunId = 0;
  private headingIconRenderVersion = 0;

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
  }

  setup(): void {
    this.setEnabled(this.isEnabled());
  }

  destroy(): void {
    this.stopRuntime();
    this.clearFileExplorerBadges();
  }

  createSelectionListenerExtension() {
    return EditorView.updateListener.of((update) => {
      if (!this.isEnabled()) {
        return;
      }
      if (!update.docChanged && !update.selectionSet) {
        return;
      }
      this.handleEditorRealtimeUpdate(update);
    });
  }

  createLineMilestoneExtension() {
    return gutter({
      class: "cw-char-milestone-gutter",
      markers: (view) => this.buildLineMilestoneMarkers(view),
    });
  }

  createHeadingIconExtension() {
    const manager = this;
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet = Decoration.none;
        headingIconVersionSeen = -1;

        constructor(view: EditorView) {
          this.headingIconVersionSeen = manager.getHeadingIconRenderVersion();
          this.decorations = manager.buildHeadingIconDecorations(view);
        }

        update(update: ViewUpdate) {
          const settingChanged =
            this.headingIconVersionSeen !== manager.getHeadingIconRenderVersion();
          if (
            settingChanged ||
            update.docChanged ||
            update.viewportChanged ||
            update.geometryChanged
          ) {
            this.headingIconVersionSeen = manager.getHeadingIconRenderVersion();
            this.decorations = manager.buildHeadingIconDecorations(update.view);
          }
        }
      },
      {
        decorations: (value) => value.decorations,
      }
    );
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.startRuntime();
      this.refreshMarkdownEditors();
      return;
    }
    this.stopRuntime();
    this.clearFileExplorerBadges();
    this.refreshMarkdownEditors();
  }

  refreshEditorDecorations(): void {
    this.headingIconRenderVersion++;
    this.refreshMarkdownEditors();
  }

  private getHeadingIconRenderVersion(): number {
    return this.headingIconRenderVersion;
  }

  onVaultFileChanged(filePath?: string): void {
    if (!this.isEnabled()) {
      return;
    }
    if (filePath) {
      this.fileCharCache.delete(filePath);
      this.pendingFileCharCount.delete(filePath);
    }
    this.folderStatsCache.clear();
    this.scheduleFileExplorerRefresh();
    this.updateStatusBar();
  }

  onActiveLeafChanged(): void {
    if (!this.isEnabled()) {
      return;
    }
    this.updateStatusBar();
  }

  private isEnabled(): boolean {
    return !!this.plugin.settings.enableMdStats;
  }

  private startRuntime(): void {
    if (!this.statusBarEl) {
      this.statusBarEl = this.plugin.addStatusBarItem();
      this.statusBarEl.addClass("cw-status-char-counter");
    }
    this.updateStatusBar();
    this.startFileExplorerObserver();
    this.scheduleFileExplorerRefresh();
  }

  private stopRuntime(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.observedExplorerRoot = null;
    this.statusBarEl?.remove();
    this.statusBarEl = null;
  }

  private updateFileCharCache(path: string, mtime: number, size: number, count: number): void {
    this.fileCharCacheVersion += 1;
    this.fileCharCache.set(path, {
      mtime,
      size,
      count,
      version: this.fileCharCacheVersion,
    });
  }

  private clearFileExplorerBadges(): void {
    const badgeSelector = ".cw-folder-md-stats, .cw-file-md-stats";
    for (const badge of Array.from(document.querySelectorAll(badgeSelector))) {
      if (badge instanceof HTMLElement) {
        badge.remove();
      }
    }
  }

  private scheduleFileExplorerRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.renderFileExplorerStats();
    }, 120);
  }

  private startFileExplorerObserver(): void {
    this.bindFileExplorerObserver();
  }

  private bindFileExplorerObserver(): void {
    const rootEl = this.getFileExplorerRootElement();
    if (!rootEl) {
      this.mutationObserver?.disconnect();
      this.observedExplorerRoot = null;
      return;
    }
    if (rootEl === this.observedExplorerRoot && this.mutationObserver) {
      return;
    }

    this.mutationObserver?.disconnect();
    this.mutationObserver = new MutationObserver(() => {
      this.scheduleFileExplorerRefresh();
    });
    this.mutationObserver.observe(rootEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-path"],
    });
    this.observedExplorerRoot = rootEl;
  }

  private async renderFileExplorerStats(): Promise<void> {
    this.bindFileExplorerObserver();
    const folderTitleEls = this.getFileExplorerFolderTitleElements();
    const fileTitleEls = this.getFileExplorerFileTitleElements();
    if (folderTitleEls.length === 0 && fileTitleEls.length === 0) {
      return;
    }

    const folderPaths = folderTitleEls.map((el) => (el.getAttribute("data-path") ?? "").trim());
    const folderStatsMap = await this.getFolderStatsForPaths(folderPaths);
    for (const folderTitleEl of folderTitleEls) {
      const folderPath = (folderTitleEl.getAttribute("data-path") ?? "").trim();
      const stats = folderStatsMap.get(folderPath) ?? { fileCount: 0, charCount: 0 };
      this.renderFolderStatsBadge(folderTitleEl, stats);
    }

    await Promise.all(fileTitleEls.map((fileTitleEl) => this.renderFileStatsBadge(fileTitleEl)));
  }

  private handleEditorRealtimeUpdate(update: ViewUpdate): void {
    const markdownView = this.getMarkdownViewForEditorView(update.view);
    const file = markdownView?.file;
    if (!markdownView || !file || file.extension !== "md") {
      this.updateStatusBar();
      return;
    }

    const selectedCount = this.countMarkdownCharacters(this.getSelectedTextFromState(update.state));
    const cachedFileCount = this.fileCharCache.get(file.path)?.count;
    const fileCount =
      update.docChanged || cachedFileCount === undefined
        ? this.countMarkdownCharacters(update.state.doc.toString())
        : cachedFileCount;
    this.setStatusBarText(fileCount, selectedCount);

    if (update.docChanged) {
      const previousFileCount = this.fileCharCache.get(file.path)?.count;
      this.updateFileCharCache(file.path, file.stat.mtime, file.stat.size, fileCount);
      if (previousFileCount === undefined) {
        this.folderStatsCache.clear();
        this.scheduleFileExplorerRefresh();
      } else {
        const delta = fileCount - previousFileCount;
        if (delta !== 0) {
          this.applyFolderStatsDelta(file.path, delta);
          this.renderVisibleFolderBadgesByPaths(this.getAncestorFolderPaths(file.path));
        }
      }
      this.renderVisibleFileBadgeByPath(file.path, fileCount);
    }
  }

  private isMarkdownViewMatchingEditorView(view: MarkdownView, editorView: EditorView): boolean {
    const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
    return cmView === editorView;
  }

  private cacheMarkdownViewEditor(view: MarkdownView): void {
    const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
    if (!cmView) {
      return;
    }
    this.editorViewToMarkdownView.set(cmView, view);
  }

  private getMarkdownViewForEditorView(editorView: EditorView): MarkdownView | null {
    const cached = this.editorViewToMarkdownView.get(editorView);
    if (cached && this.isMarkdownViewMatchingEditorView(cached, editorView)) {
      return cached;
    }

    const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (!this.isMarkdownViewMatchingEditorView(view, editorView)) {
        this.cacheMarkdownViewEditor(view);
        continue;
      }
      this.cacheMarkdownViewEditor(view);
      return view;
    }
    return null;
  }

  private renderVisibleFileBadgeByPath(filePath: string, charCount: number): void {
    const fileTitleEls = this.getFileExplorerFileTitleElements();
    for (const fileTitleEl of fileTitleEls) {
      if ((fileTitleEl.getAttribute("data-path") ?? "") !== filePath) {
        continue;
      }
      const text = `${this.formatCharCount(charCount)}`;
      let badgeEl = fileTitleEl.querySelector(".cw-file-md-stats") as HTMLElement | null;
      if (!badgeEl) {
        badgeEl = fileTitleEl.createSpan({ cls: "cw-file-md-stats" });
      }
      badgeEl.setText(text);
      return;
    }
  }

  private renderVisibleFolderBadgesByPaths(folderPaths: string[]): void {
    const pathSet = new Set(folderPaths);
    const folderTitleEls = this.getFileExplorerFolderTitleElements();
    for (const folderTitleEl of folderTitleEls) {
      const folderPath = (folderTitleEl.getAttribute("data-path") ?? "").trim();
      if (!pathSet.has(folderPath)) {
        continue;
      }
      const cached = this.folderStatsCache.get(folderPath);
      if (!cached) {
        continue;
      }
      this.renderFolderStatsBadge(folderTitleEl, cached);
    }
  }

  private applyFolderStatsDelta(filePath: string, delta: number): void {
    if (delta === 0) return;
    const paths = this.getAncestorFolderPaths(filePath);
    for (const path of paths) {
      const cached = this.folderStatsCache.get(path);
      if (!cached) continue;
      cached.charCount = Math.max(0, cached.charCount + delta);
      this.folderStatsCache.set(path, cached);
    }
  }

  private getAncestorFolderPaths(filePath: string): string[] {
    const normalized = filePath.replace(/^\/+|\/+$/g, "");
    const parts = normalized.split("/");
    if (parts.length <= 1) return [""];
    const result: string[] = [""];
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : (parts[i] ?? "");
      if (current) {
        result.push(current);
      }
    }
    return result;
  }

  private getSelectedTextFromState(state: EditorView["state"]): string {
    const parts: string[] = [];
    for (const range of state.selection.ranges) {
      if (range.empty) continue;
      parts.push(state.doc.sliceString(range.from, range.to));
    }
    return parts.join("");
  }

  private buildHeadingIconDecorations(view: EditorView): DecorationSet {
    if (!this.plugin.settings.enableEditorHeadingIcons) {
      return Decoration.none;
    }
    const markdownView = this.getMarkdownViewForEditorView(view);
    const file = markdownView?.file;
    if (!file || file.extension !== "md") {
      return Decoration.none;
    }

    const builder = new RangeSetBuilder<Decoration>();
    for (const range of view.visibleRanges) {
      let line = view.state.doc.lineAt(range.from);
      while (line.from <= range.to) {
        const match = line.text.match(/^(\s{0,3})(#{1,6})\s+/);
        if (match) {
          const leadingSpaces = match[1]?.length ?? 0;
          const level = match[2]?.length ?? 0;
          if (level >= 1 && level <= 6) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: `cw-heading-line-with-icon cw-heading-line-h${level}` })
            );
            builder.add(
              line.from + leadingSpaces,
              line.from + leadingSpaces,
              Decoration.widget({
                widget: new HeadingLevelIconWidget(level),
                side: 1,
              })
            );
          }
        }
        if (line.to + 1 > view.state.doc.length) break;
        line = view.state.doc.lineAt(line.to + 1);
      }
    }

    return builder.finish();
  }

  private buildLineMilestoneMarkers(view: EditorView): RangeSet<GutterMarker> {
    if (!this.isEnabled()) {
      return RangeSet.empty;
    }
    const markdownView = this.getMarkdownViewForEditorView(view);
    const file = markdownView?.file;
    if (!file || file.extension !== "md") {
      return RangeSet.empty;
    }

    const lineCount = view.state.doc.lines;
    if (lineCount === 0) {
      return RangeSet.empty;
    }

    const frontmatterEndLine = this.getFrontmatterEndLine(view.state.doc);
    const builder = new RangeSetBuilder<GutterMarker>();
    let cumulative = 0;
    let nextMilestone = 500;

    for (let lineNo = 1; lineNo <= lineCount; lineNo++) {
      if (frontmatterEndLine > 0 && lineNo <= frontmatterEndLine) {
        continue;
      }
      const line = view.state.doc.line(lineNo);
      const lineCountValue = this.countLineCharacters(line.text);
      cumulative += lineCountValue;

      if (cumulative < nextMilestone) {
        continue;
      }

      let reachedMilestone = nextMilestone;
      while (cumulative >= nextMilestone) {
        reachedMilestone = nextMilestone;
        nextMilestone += 500;
      }
      const targetLineNo = lineNo < lineCount ? lineNo + 1 : lineNo;
      const targetLine = view.state.doc.line(targetLineNo);
      builder.add(targetLine.from, targetLine.from, new CharMilestoneMarker(`${reachedMilestone}字`));
    }

    return builder.finish();
  }

  private getFrontmatterEndLine(doc: EditorView["state"]["doc"]): number {
    if (doc.lines < 1) return 0;
    if (doc.line(1).text.trim() !== "---") {
      return 0;
    }
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.trim() === "---") {
        return i;
      }
    }
    return 0;
  }

  private countLineCharacters(line: string): number {
    const withoutHeading = line.replace(/^\s{0,3}#{1,6}\s+/, "");
    const withNumberToken = withoutHeading.replace(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?/g, "N");
    return withNumberToken.replace(/[\s-]+/g, "").length;
  }

  private refreshMarkdownEditors(): void {
    const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.editor) {
        continue;
      }
      const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
      if (!cmView) {
        continue;
      }
      cmView.dispatch({
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }

  private getFileExplorerFolderTitleElements(): HTMLElement[] {
    const selector =
      '.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title[data-path]';
    return Array.from(document.querySelectorAll(selector))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);
  }

  private getFileExplorerRootElement(): HTMLElement | null {
    const selector = '.workspace-leaf-content[data-type="file-explorer"]';
    const rootEl = document.querySelector(selector);
    return rootEl instanceof HTMLElement ? rootEl : null;
  }

  private getFileExplorerFileTitleElements(): HTMLElement[] {
    const selector =
      '.workspace-leaf-content[data-type="file-explorer"] .nav-file-title[data-path]';
    return Array.from(document.querySelectorAll(selector))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);
  }

  private renderFolderStatsBadge(folderTitleEl: HTMLElement, stats: FolderStats): void {
    const text = `${stats.fileCount}章 | ${this.formatCharCount(stats.charCount)}`;
    let badgeEl = folderTitleEl.querySelector(".cw-folder-md-stats") as HTMLElement | null;
    if (!badgeEl) {
      badgeEl = folderTitleEl.createSpan({ cls: "cw-folder-md-stats" });
    }
    badgeEl.setText(text);
  }

  private async renderFileStatsBadge(fileTitleEl: HTMLElement): Promise<void> {
    const filePath = (fileTitleEl.getAttribute("data-path") ?? "").trim();
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      const existing = fileTitleEl.querySelector(".cw-file-md-stats");
      existing?.remove();
      return;
    }

    const charCount = await this.getFileCharCount(file);
    const text = `${this.formatCharCount(charCount)}`;
    let badgeEl = fileTitleEl.querySelector(".cw-file-md-stats") as HTMLElement | null;
    if (!badgeEl) {
      badgeEl = fileTitleEl.createSpan({ cls: "cw-file-md-stats" });
    }
    badgeEl.setText(text);
  }

  private async getFolderStatsForPaths(folderPaths: string[]): Promise<Map<string, FolderStats>> {
    const requestedPaths = new Set(folderPaths.map((path) => path.trim()));
    const result = new Map<string, FolderStats>();
    const missingPaths: string[] = [];

    for (const path of requestedPaths) {
      const cached = this.folderStatsCache.get(path);
      if (cached) {
        result.set(path, cached);
        continue;
      }
      missingPaths.push(path);
    }

    if (missingPaths.length === 0) {
      return result;
    }

    const missingPathSet = new Set(missingPaths);
    const aggregated = new Map<string, FolderStats>();
    const files = this.plugin.app.vault.getMarkdownFiles();
    const counts = await Promise.all(files.map(async (file) => this.getFileCharCount(file)));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) {
        continue;
      }
      const fileCount = counts[i] ?? 0;
      const ancestors = this.getAncestorFolderPaths(file.path);
      for (const ancestor of ancestors) {
        if (!missingPathSet.has(ancestor)) {
          continue;
        }
        const current = aggregated.get(ancestor) ?? { fileCount: 0, charCount: 0 };
        current.fileCount += 1;
        current.charCount += fileCount;
        aggregated.set(ancestor, current);
      }
    }

    for (const path of missingPaths) {
      const stats = aggregated.get(path) ?? { fileCount: 0, charCount: 0 };
      this.folderStatsCache.set(path, stats);
      result.set(path, stats);
    }

    return result;
  }

  private async getFileCharCount(file: TFile): Promise<number> {
    const cached = this.fileCharCache.get(file.path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      return cached.count;
    }

    const pending = this.pendingFileCharCount.get(file.path);
    if (pending) {
      return pending;
    }

    const startVersion = this.fileCharCache.get(file.path)?.version ?? 0;
    const task = (async () => {
      const content = await this.plugin.app.vault.read(file);
      const count = this.countMarkdownCharacters(content);
      const latest = this.fileCharCache.get(file.path);
      const latestVersion = latest?.version ?? 0;
      if (latestVersion !== startVersion) {
        return latest?.count ?? count;
      }
      this.updateFileCharCache(file.path, file.stat.mtime, file.stat.size, count);
      return count;
    })();
    this.pendingFileCharCount.set(file.path, task);

    try {
      return await task;
    } finally {
      this.pendingFileCharCount.delete(file.path);
    }
  }

  private countMarkdownCharacters(rawText: string): number {
    const textWithoutFrontmatter = this.stripFrontmatter(rawText);
    const lines = textWithoutFrontmatter.split("\n");
    const normalized = lines
      .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, ""))
      .join("");

    // 数字（含正负号、小数、百分号）按 1 个字符计数
    const withNumberToken = normalized.replace(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?/g, "N");
    // 其余按字符统计，排除空白字符（空格、制表符、换行等）与连字符 "-"
    return withNumberToken.replace(/[\s-]+/g, "").length;
  }

  private stripFrontmatter(rawText: string): string {
    const normalizedText = rawText.replace(/\r\n/g, "\n");
    const lines = normalizedText.split("\n");
    if ((lines[0] ?? "").trim() !== "---") {
      return normalizedText;
    }

    for (let i = 1; i < lines.length; i++) {
      if ((lines[i] ?? "").trim() === "---") {
        return lines.slice(i + 1).join("\n");
      }
    }
    return normalizedText;
  }

  private formatCharCount(charCount: number): string {
    if (charCount < 10000) {
      return `${charCount}字`;
    }
    return `${(charCount / 10000).toFixed(1)}万`;
  }

  async updateStatusBar(): Promise<void> {
    const runId = ++this.statusUpdateRunId;
    const statusText = await this.buildStatusBarText();
    if (runId !== this.statusUpdateRunId) {
      return;
    }
    if (!this.statusBarEl) {
      return;
    }
    this.statusBarEl.setText(statusText);
  }

  private async buildStatusBarText(): Promise<string> {
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView?.file;
    if (!activeFile || activeFile.extension !== "md") {
      return "";
    }

    const fileCount = await this.getFileCharCount(activeFile);
    const selectedTextRaw = activeView.editor?.getSelection() ?? "";
    const selectedCount = selectedTextRaw
      ? this.countMarkdownCharacters(selectedTextRaw)
      : 0;

    return this.buildStatusText(fileCount, selectedCount);
  }

  private setStatusBarText(fileCount: number, selectedCount: number): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.setText(this.buildStatusText(fileCount, selectedCount));
  }

  private buildStatusText(fileCount: number, selectedCount: number): string {
    if (selectedCount > 0) {
      return `${selectedCount}字 / ${fileCount}字`;
    }
    return `${fileCount}字`;
  }
}
