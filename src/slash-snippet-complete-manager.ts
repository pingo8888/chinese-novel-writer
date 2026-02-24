import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, keymap } from "@codemirror/view";
import { TFile, TFolder } from "obsidian";
import type ChineseWriterPlugin from "./main";

interface SlashQueryMatch {
  from: number;
  to: number;
  query: string;
}

interface SnippetItem {
  key: string;
  content: string;
  preview: string;
  order: number;
}

interface SlashRuntimeHandle {
  isOpen(): boolean;
  move(delta: number): void;
  flipPage(delta: number): void;
  accept(): void;
  hide(): void;
}

export type SlashSnippetReloadStatus = "ok" | "missing-path" | "invalid-folder" | "error";

export interface SlashSnippetReloadResult {
  status: SlashSnippetReloadStatus;
  count: number;
  path: string;
}

export class SlashSnippetCompleteManager {
  private plugin: ChineseWriterPlugin;
  private runtimeByView: WeakMap<EditorView, SlashRuntimeHandle> = new WeakMap();
  private snippets: SnippetItem[] = [];

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
  }

  createEditorExtension() {
    const manager = this;

    const popupPlugin = ViewPlugin.fromClass(
      class {
        private view: EditorView;
        private popupEl: HTMLDivElement | null = null;
        private listEl: HTMLDivElement | null = null;
        private pageInfoEl: HTMLDivElement | null = null;
        private candidates: SnippetItem[] = [];
        private activeIndex = 0;
        private replaceFrom = 0;
        private replaceTo = 0;
        private open = false;
        private lastQuery = "";

        constructor(view: EditorView) {
          this.view = view;
          manager.runtimeByView.set(view, {
            isOpen: () => this.open,
            move: (delta: number) => this.move(delta),
            flipPage: (delta: number) => this.flipPage(delta),
            accept: () => this.accept(),
            hide: () => this.hide(),
          });
          this.refresh();
        }

        update(update: ViewUpdate): void {
          if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) {
            this.refresh();
          }
        }

        private refresh(): void {
          if (!manager.plugin.settings.enableSlashSnippetCandidateBar) {
            this.hide();
            return;
          }
          if (!this.view.hasFocus) {
            this.hide();
            return;
          }

          const match = manager.detectSlashQuery(this.view);
          if (!match) {
            this.hide();
            return;
          }

          const filtered = manager.filterCandidates(match.query);
          if (filtered.length === 0) {
            this.hide();
            return;
          }

          this.replaceFrom = match.from;
          this.replaceTo = match.to;
          this.candidates = filtered;

          if (match.query !== this.lastQuery) {
            this.activeIndex = 0;
            this.lastQuery = match.query;
          } else if (this.activeIndex >= this.candidates.length) {
            this.activeIndex = this.candidates.length - 1;
          }

          this.render(this.replaceTo);
        }

        private ensurePopup(): void {
          if (this.popupEl && this.listEl && this.pageInfoEl) return;

          this.popupEl = document.createElement("div");
          this.popupEl.className = "cw-slash-h2-popup";
          this.listEl = document.createElement("div");
          this.listEl.className = "cw-slash-h2-list";
          this.pageInfoEl = document.createElement("div");
          this.pageInfoEl.className = "cw-slash-h2-page-info";
          this.popupEl.appendChild(this.listEl);
          this.popupEl.appendChild(this.pageInfoEl);
          document.body.appendChild(this.popupEl);

          this.popupEl.addEventListener("mousedown", (event) => {
            event.preventDefault();
            const target = event.target as HTMLElement;
            const item = target.closest(".cw-slash-h2-item") as HTMLElement | null;
            if (!item) return;
            const index = Number(item.dataset.index ?? "-1");
            if (Number.isNaN(index) || index < 0 || index >= this.candidates.length) return;
            this.activeIndex = index;
            this.accept();
          });
        }

        private render(pos: number): void {
          this.ensurePopup();
          if (!this.popupEl || !this.listEl || !this.pageInfoEl) return;

          const pageSize = manager.getPageSize();
          const pageCount = Math.max(1, Math.ceil(this.candidates.length / pageSize));
          const currentPage = Math.floor(this.activeIndex / pageSize);
          const pageStart = currentPage * pageSize;
          const pageEnd = Math.min(this.candidates.length, pageStart + pageSize);

          this.listEl.empty();
          this.candidates.slice(pageStart, pageEnd).forEach((item, offset) => {
            const index = pageStart + offset;
            const rowEl = this.listEl!.createDiv({ cls: "cw-slash-h2-item" });
            rowEl.dataset.index = String(index);
            rowEl.setText(item.preview);
            if (index === this.activeIndex) rowEl.addClass("is-active");
          });

          this.pageInfoEl.setText(`第 ${currentPage + 1}/${pageCount} 页（←/→ 翻页，↑/↓ 选择，Enter 确认）`);
          this.popupEl.style.display = "flex";
          this.open = true;
          this.positionPopup(pos);
        }

        private move(delta: number): void {
          if (!this.open || this.candidates.length === 0) return;
          const pageSize = manager.getPageSize();
          const pageStart = Math.floor(this.activeIndex / pageSize) * pageSize;
          const pageEnd = Math.min(this.candidates.length - 1, pageStart + pageSize - 1);
          this.activeIndex = Math.min(pageEnd, Math.max(pageStart, this.activeIndex + delta));
          this.render(this.replaceTo);
        }

        private flipPage(delta: number): void {
          if (!this.open || this.candidates.length === 0) return;
          const pageSize = manager.getPageSize();
          const pageCount = Math.max(1, Math.ceil(this.candidates.length / pageSize));
          const currentPage = Math.floor(this.activeIndex / pageSize);
          const targetPage = Math.max(0, Math.min(pageCount - 1, currentPage + delta));
          this.activeIndex = targetPage * pageSize;
          this.render(this.replaceTo);
        }

        private positionPopup(pos: number): void {
          const popup = this.popupEl;
          if (!popup) return;

          this.view.requestMeasure({
            read: () => {
              const coords = this.view.coordsAtPos(pos);
              if (!coords) return null;
              return {
                coords,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                popupWidth: popup.offsetWidth || 260,
                popupHeight: popup.offsetHeight || 240,
                pageInfoHeight: this.pageInfoEl?.offsetHeight || 24,
              };
            },
            write: (measure) => {
              if (!measure || !this.popupEl) {
                this.hide();
                return;
              }

              const margin = 8;
              const gap = 6;
              const desiredLeft = measure.coords.left;
              const desiredTop = measure.coords.bottom + gap;

              const maxLeft = Math.max(margin, measure.viewportWidth - measure.popupWidth - margin);
              const left = Math.min(Math.max(margin, desiredLeft), maxLeft);

              const availableBelow = Math.max(0, measure.viewportHeight - (measure.coords.bottom + gap) - margin);
              const availableAbove = Math.max(0, measure.coords.top - gap - margin);
              const preferredMaxHeight = 320;
              const minPopupHeight = Math.max(88, measure.pageInfoHeight + 64);
              const bestAvailable = Math.max(availableBelow, availableAbove);
              const appliedMaxHeight = Math.max(
                minPopupHeight,
                Math.min(preferredMaxHeight, bestAvailable > 0 ? bestAvailable : preferredMaxHeight)
              );

              this.popupEl.style.maxHeight = `${Math.floor(appliedMaxHeight)}px`;
              const effectiveHeight = Math.min(measure.popupHeight, appliedMaxHeight);

              let top = desiredTop;
              const fitsBelow = desiredTop + effectiveHeight <= measure.viewportHeight - margin;
              const fitsAbove = measure.coords.top - gap - effectiveHeight >= margin;
              if (!fitsBelow && fitsAbove) {
                top = measure.coords.top - effectiveHeight - gap;
              }
              if (top + effectiveHeight > measure.viewportHeight - margin) {
                top = measure.viewportHeight - margin - effectiveHeight;
              }
              if (top < margin) {
                top = margin;
              }

              this.popupEl.style.left = `${left}px`;
              this.popupEl.style.top = `${top}px`;
            },
          });
        }

        private accept(): void {
          if (!this.open || this.candidates.length === 0) return;
          const selected = this.candidates[this.activeIndex];
          if (!selected) return;
          const resolved = manager.resolveSnippetInsert(selected.content);

          this.view.dispatch({
            changes: { from: this.replaceFrom, to: this.replaceTo, insert: resolved.text },
            selection: EditorSelection.cursor(this.replaceFrom + resolved.cursorOffset),
            scrollIntoView: true,
          });
          this.hide();
        }

        private hide(): void {
          this.open = false;
          this.lastQuery = "";
          if (this.popupEl) {
            this.popupEl.remove();
            this.popupEl = null;
          }
          this.listEl = null;
          this.pageInfoEl = null;
        }

        destroy(): void {
          manager.runtimeByView.delete(this.view);
          this.hide();
        }
      },
      {
        eventHandlers: {
          blur(this: any) {
            this.hide?.();
            return false;
          },
        },
      }
    );

    const slashKeymap = Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: (view) => manager.handleKey(view, "down") },
        { key: "ArrowUp", run: (view) => manager.handleKey(view, "up") },
        { key: "ArrowRight", run: (view) => manager.handleKey(view, "pageNext") },
        { key: "ArrowLeft", run: (view) => manager.handleKey(view, "pagePrev") },
        { key: "Enter", run: (view) => manager.handleKey(view, "accept") },
        { key: "Escape", run: (view) => manager.handleKey(view, "close") },
      ])
    );

    return [popupPlugin, slashKeymap];
  }

  async reloadSnippets(): Promise<SlashSnippetReloadResult> {
    const path = this.plugin.settings.slashSnippetFolderPath.trim();
    if (!path) {
      this.snippets = [];
      return { status: "missing-path", count: 0, path };
    }

    const folder = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) {
      this.snippets = [];
      return { status: "invalid-folder", count: 0, path };
    }

    try {
      const prefix = folder.path ? `${folder.path}/` : "";
      const allMarkdownFiles = this.plugin.app.vault
        .getMarkdownFiles()
        .filter((file) => file.path.startsWith(prefix))
        .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));

      const snippets: SnippetItem[] = [];
      let order = 0;
      for (const file of allMarkdownFiles) {
        const content = await this.plugin.app.vault.cachedRead(file);
        const parsed = this.parseSnippets(content);
        for (const item of parsed) {
          snippets.push({
            key: item.key,
            content: item.content,
            preview: item.preview,
            order: order++,
          });
        }
      }
      this.snippets = snippets;
      return { status: "ok", count: this.snippets.length, path };
    } catch (error) {
      console.error("Failed to load slash snippets:", error);
      this.snippets = [];
      return { status: "error", count: 0, path };
    }
  }

  onVaultPathChanged(path: string, oldPath?: string): void {
    const configured = this.plugin.settings.slashSnippetFolderPath.trim();
    if (!configured) return;
    const inConfigured = path === configured || path.startsWith(`${configured}/`);
    const oldInConfigured = oldPath === configured || (!!oldPath && oldPath.startsWith(`${configured}/`));
    if (inConfigured || oldInConfigured) {
      void this.reloadSnippets();
    }
  }

  private handleKey(
    view: EditorView,
    action: "down" | "up" | "pageNext" | "pagePrev" | "accept" | "close"
  ): boolean {
    const runtime = this.runtimeByView.get(view);
    if (!runtime?.isOpen()) return false;

    if (action === "down") runtime.move(1);
    else if (action === "up") runtime.move(-1);
    else if (action === "pageNext") runtime.flipPage(1);
    else if (action === "pagePrev") runtime.flipPage(-1);
    else if (action === "accept") runtime.accept();
    else runtime.hide();
    return true;
  }

  private detectSlashQuery(view: EditorView): SlashQueryMatch | null {
    const selection = view.state.selection.main;
    if (!selection.empty) return null;

    const cursorPos = selection.head;
    const line = view.state.doc.lineAt(cursorPos);
    const beforeCursor = line.text.slice(0, cursorPos - line.from);
    const match = /\/\/([A-Za-z]+)$/.exec(beforeCursor);
    if (!match) return null;

    return { from: line.from + match.index, to: cursorPos, query: match[1] ?? "" };
  }

  private filterCandidates(query: string): SnippetItem[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [...this.snippets].sort((a, b) => a.order - b.order);
    }

    const filtered = this.snippets.filter((item) => item.key.toLowerCase().includes(normalized));
    filtered.sort((a, b) => {
      const aLower = a.key.toLowerCase();
      const bLower = b.key.toLowerCase();
      const aStarts = aLower.startsWith(normalized) ? 0 : 1;
      const bStarts = bLower.startsWith(normalized) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;

      const aIndex = aLower.indexOf(normalized);
      const bIndex = bLower.indexOf(normalized);
      if (aIndex !== bIndex) return aIndex - bIndex;

      if (aLower.length !== bLower.length) return aLower.length - bLower.length;
      return a.order - b.order;
    });
    return filtered;
  }

  private getPageSize(): number {
    const configured = this.plugin.settings.slashH2CandidatePageSize;
    if (!Number.isFinite(configured)) return 8;
    return Math.max(1, Math.floor(configured));
  }

  private parseSnippets(content: string): SnippetItem[] {
    const lines = content.split("\n");
    const snippets: SnippetItem[] = [];

    let currentKey = "";
    let currentPreview = "";
    let currentContentLines: string[] = [];
    let order = 0;

    const flush = () => {
      if (!currentKey) return;
      const key = currentKey.trim();
      const preview = this.stripCursorMarker(currentPreview).trim();
      if (!/^[A-Za-z]+$/.test(key)) {
        currentKey = "";
        currentPreview = "";
        currentContentLines = [];
        return;
      }

      const normalizedContent = this.normalizeContent(currentContentLines);
      if (!normalizedContent) {
        currentKey = "";
        currentPreview = "";
        currentContentLines = [];
        return;
      }

      snippets.push({
        key,
        content: normalizedContent,
        preview: preview || this.buildPreviewFromContent(normalizedContent),
        order: order++,
      });
      currentKey = "";
      currentPreview = "";
      currentContentLines = [];
    };

    for (const line of lines) {
      const headingMatch = /^##\s+([A-Za-z]+)(?:@(.*))?\s*$/.exec(line.trim());
      if (headingMatch) {
        flush();
        currentKey = headingMatch[1] ?? "";
        currentPreview = (headingMatch[2] ?? "").trim();
        continue;
      }

      if (currentKey) {
        currentContentLines.push(line);
      }
    }

    flush();
    return snippets;
  }

  private normalizeContent(lines: string[]): string {
    let start = 0;
    let end = lines.length;
    while (start < end && (lines[start] ?? "").trim().length === 0) start += 1;
    while (end > start && (lines[end - 1] ?? "").trim().length === 0) end -= 1;
    return lines.slice(start, end).join("\n");
  }

  private buildPreviewFromContent(content: string): string {
    return this.stripCursorMarker(content).replace(/\s+/g, " ").trim();
  }

  private resolveSnippetInsert(raw: string): { text: string; cursorOffset: number } {
    const marker = "{$cursor}";
    const firstMarkerIndex = raw.indexOf(marker);
    const markerLength = marker.length;
    let text = raw;

    if (firstMarkerIndex >= 0) {
      text = `${raw.slice(0, firstMarkerIndex)}${raw.slice(firstMarkerIndex + markerLength)}`;
    }
    text = text.split(marker).join("");

    const cursorOffset = firstMarkerIndex >= 0 ? firstMarkerIndex : text.length;
    return { text, cursorOffset };
  }

  private stripCursorMarker(text: string): string {
    return text.split("{$cursor}").join("");
  }

}
