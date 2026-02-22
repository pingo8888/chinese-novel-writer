import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, keymap } from "@codemirror/view";
import type ChineseWriterPlugin from "./main";

interface SlashQueryMatch {
  from: number;
  to: number;
  query: string;
}

interface SlashRuntimeHandle {
  isOpen(): boolean;
  move(delta: number): void;
  flipPage(delta: number): void;
  accept(): void;
  hide(): void;
}

export class SlashH2CompleteManager {
  private plugin: ChineseWriterPlugin;
  private runtimeByView: WeakMap<EditorView, SlashRuntimeHandle> = new WeakMap();

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
        private candidates: string[] = [];
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
          if (!manager.plugin.settings.enableSlashH2CandidateBar) {
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

          const filtered = manager.filterCandidates(manager.plugin.getCurrentTreeH2Texts(), match.query);
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
            rowEl.setText(item);
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
          const value = this.candidates[this.activeIndex];
          if (!value) return;

          this.view.dispatch({
            changes: { from: this.replaceFrom, to: this.replaceTo, insert: value },
            selection: EditorSelection.cursor(this.replaceFrom + value.length),
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
    const match = /\/\/([^\s/]*)$/.exec(beforeCursor);
    if (!match) return null;

    return { from: line.from + match.index, to: cursorPos, query: match[1] ?? "" };
  }

  private filterCandidates(values: string[], query: string): string[] {
    const normalizedQuery = query.trim().toLowerCase();
    const uniqueValues = Array.from(
      new Set(values.map((item) => item.trim()).filter((item) => item.length > 0))
    );

    if (!normalizedQuery) {
      return uniqueValues.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    }

    const filtered = uniqueValues.filter((item) => item.toLowerCase().includes(normalizedQuery));
    filtered.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aStarts = aLower.startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = bLower.startsWith(normalizedQuery) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;

      const aIndex = aLower.indexOf(normalizedQuery);
      const bIndex = bLower.indexOf(normalizedQuery);
      if (aIndex !== bIndex) return aIndex - bIndex;

      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b, "zh-Hans-CN");
    });
    return filtered;
  }

  private getPageSize(): number {
    const configured = this.plugin.settings.slashH2CandidatePageSize;
    if (!Number.isFinite(configured)) return 8;
    return Math.max(1, Math.floor(configured));
  }
}