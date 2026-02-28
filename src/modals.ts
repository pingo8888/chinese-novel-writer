import { App, Modal } from "obsidian";

/**
 * 文本输入对话框
 */
export class TextInputModal extends Modal {
  private title: string;
  private placeholder: string;
  private defaultValue: string;
  private onSubmit: (value: string) => void;
  private suggestions: string[];
  private onCancel?: () => void;
  private suggestionContainerEl?: HTMLElement;
  private viewportListener?: () => void;
  private submitted = false; // 防止重复提交

  constructor(
    app: App,
    title: string,
    placeholder: string,
    defaultValue: string,
    onSubmit: (value: string) => void,
    suggestions: string[] = [],
    onCancel?: () => void
  ) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
    this.suggestions = suggestions;
    this.onCancel = onCancel;
  }

  onOpen() {
    const { contentEl } = this;

    const modalEl = contentEl.closest(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.classList.add("cw-modal");
      const containerEl = modalEl.parentElement;
      if (containerEl) {
        containerEl.classList.add("cw-modal-container");
      }
    }
    contentEl.classList.add("cw-modal-content");

    contentEl.createEl("h2", { text: this.title, cls: "cw-modal-title" });

    const inputWrapper = contentEl.createDiv({ cls: "cw-input-wrapper" });

    const inputEl = inputWrapper.createEl("input", {
      type: "text",
      placeholder: this.placeholder,
      value: this.defaultValue,
      cls: "cw-text-input",
    });

    const suggestionContainer = document.createElement("div");
    suggestionContainer.classList.add("cw-suggestion-container", "cw-suggestion-container-floating");
    document.body.appendChild(suggestionContainer);
    suggestionContainer.hidden = true;
    this.suggestionContainerEl = suggestionContainer;
    let filteredSuggestions: string[] = [];
    let activeSuggestionIndex = -1;

    const updateSuggestionPosition = () => {
      const rect = inputEl.getBoundingClientRect();
      suggestionContainer.style.left = `${Math.round(rect.left)}px`;
      suggestionContainer.style.top = `${Math.round(rect.bottom + 4)}px`;
      suggestionContainer.style.width = `${Math.round(rect.width)}px`;
    };
    const syncSuggestionPositionAfterLayout = () => {
      requestAnimationFrame(() => {
        updateSuggestionPosition();
        requestAnimationFrame(() => {
          updateSuggestionPosition();
        });
      });
      setTimeout(() => {
        if (!suggestionContainer.hidden) {
          updateSuggestionPosition();
        }
      }, 60);
    };

    const viewportListener = () => {
      if (!suggestionContainer.hidden) {
        updateSuggestionPosition();
      }
    };
    this.viewportListener = viewportListener;
    window.addEventListener("resize", viewportListener);
    window.addEventListener("scroll", viewportListener, true);

    const applyRowStyle = (row: HTMLElement, isActive: boolean) => {
      row.classList.toggle("is-active", isActive);
    };

    const updateActiveSuggestion = () => {
      const rows = Array.from(suggestionContainer.children) as HTMLElement[];
      rows.forEach((row, idx) => {
        applyRowStyle(row, idx === activeSuggestionIndex);
      });
      if (
        activeSuggestionIndex >= 0 &&
        activeSuggestionIndex < rows.length
      ) {
        const activeRow = rows[activeSuggestionIndex];
        if (activeRow) {
          activeRow.scrollIntoView({ block: "nearest" });
        }
      }
    };

    const acceptActiveSuggestion = () => {
      if (
        activeSuggestionIndex < 0 ||
        activeSuggestionIndex >= filteredSuggestions.length
      ) {
        return false;
      }
      const selected = filteredSuggestions[activeSuggestionIndex];
      if (!selected) {
        return false;
      }
      inputEl.value = selected;
      suggestionContainer.hidden = true;
      suggestionContainer.empty();
      filteredSuggestions = [];
      activeSuggestionIndex = -1;
      return true;
    };

    const renderSuggestions = (keyword: string) => {
      if (this.suggestions.length === 0) {
        suggestionContainer.hidden = true;
        filteredSuggestions = [];
        activeSuggestionIndex = -1;
        return;
      }

      const normalized = keyword.trim().toLowerCase();
      if (!normalized) {
        suggestionContainer.hidden = true;
        suggestionContainer.empty();
        filteredSuggestions = [];
        activeSuggestionIndex = -1;
        return;
      }
      filteredSuggestions = this.suggestions
        .filter((item) => item.toLowerCase().includes(normalized))
        .slice(0, 50);

      suggestionContainer.empty();

      if (filteredSuggestions.length === 0) {
        suggestionContainer.hidden = true;
        activeSuggestionIndex = -1;
        return;
      }

      suggestionContainer.hidden = false;
      updateSuggestionPosition();
      syncSuggestionPositionAfterLayout();
      activeSuggestionIndex = 0;

      filteredSuggestions.forEach((item, idx) => {
        const row = suggestionContainer.createDiv({ text: item, cls: "cw-suggestion-row" });
        row.addEventListener("mouseenter", () => {
          activeSuggestionIndex = idx;
          updateActiveSuggestion();
        });
        row.addEventListener("mouseleave", () => {
          updateActiveSuggestion();
        });
        row.addEventListener("click", () => {
          activeSuggestionIndex = idx;
          acceptActiveSuggestion();
          inputEl.value = item;
          inputEl.focus();
        });
      });
      updateActiveSuggestion();
    };

    // 自动聚焦并选中文本
    inputEl.focus();
    inputEl.select();
    renderSuggestions(inputEl.value);
    syncSuggestionPositionAfterLayout();

    const buttonContainer = contentEl.createDiv({ cls: "cw-modal-buttons" });

    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    const submitBtn = buttonContainer.createEl("button", {
      text: "确定",
      cls: "mod-cta",
    });

    // 提交处理函数
    const doSubmit = () => {
      if (this.submitted) {
        return; // 防止重复提交
      }
      this.submitted = true;

      const value = inputEl.value;
      this.close();
      // 使用 setTimeout 确保 modal 完全关闭后再执行回调
      setTimeout(() => {
        this.onSubmit(value);
      }, 10);
    };

    submitBtn.addEventListener("click", doSubmit);

    // 回车提交
    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" && !suggestionContainer.hidden) {
        e.preventDefault();
        if (filteredSuggestions.length > 0) {
          activeSuggestionIndex =
            (activeSuggestionIndex + 1 + filteredSuggestions.length) % filteredSuggestions.length;
          updateActiveSuggestion();
        }
      } else if (e.key === "ArrowUp" && !suggestionContainer.hidden) {
        e.preventDefault();
        if (filteredSuggestions.length > 0) {
          if (activeSuggestionIndex === -1) {
            activeSuggestionIndex = filteredSuggestions.length - 1;
          } else {
            activeSuggestionIndex =
              (activeSuggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
          }
          updateActiveSuggestion();
        }
      } else if (e.key === "Enter" && !suggestionContainer.hidden) {
        e.preventDefault();
        if (activeSuggestionIndex >= 0) {
          acceptActiveSuggestion();
        }
        doSubmit();
      } else if (e.key === "Enter") {
        doSubmit();
      } else if (e.key === "Escape") {
        this.close();
      }
    });
    inputEl.addEventListener("input", () => {
      activeSuggestionIndex = 0;
      renderSuggestions(inputEl.value);
    });
    inputEl.addEventListener("blur", () => {
      setTimeout(() => {
        suggestionContainer.hidden = true;
      }, 120);
    });
  }

  onClose() {
    const { contentEl } = this;
    const modalEl = contentEl.closest(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.classList.remove("cw-modal");
      const containerEl = modalEl.parentElement;
      if (containerEl) {
        containerEl.classList.remove("cw-modal-container");
      }
    }
    if (this.viewportListener) {
      window.removeEventListener("resize", this.viewportListener);
      window.removeEventListener("scroll", this.viewportListener, true);
      this.viewportListener = undefined;
    }
    if (this.suggestionContainerEl) {
      this.suggestionContainerEl.remove();
      this.suggestionContainerEl = undefined;
    }
    if (!this.submitted) {
      this.onCancel?.();
    }
    contentEl.empty();
  }
}

/**
 * 确认对话框
 */
export class ConfirmModal extends Modal {
  private title: string;
  private message: string;
  private onConfirm: () => void;

  constructor(
    app: App,
    title: string,
    message: string,
    onConfirm: () => void
  ) {
    super(app);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;

    const modalEl = contentEl.closest(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.classList.add("cw-modal");
      const containerEl = modalEl.parentElement;
      if (containerEl) {
        containerEl.classList.add("cw-modal-container");
      }
    }
    contentEl.classList.add("cw-modal-content");

    contentEl.createEl("h2", { text: this.title, cls: "cw-modal-title" });
    contentEl.createEl("p", { text: this.message, cls: "cw-modal-message" });

    const buttonContainer = contentEl.createDiv({ cls: "cw-modal-buttons cw-modal-buttons-confirm" });

    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    const confirmBtn = buttonContainer.createEl("button", {
      text: "确定",
      cls: "mod-warning",
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    const { contentEl } = this;
    const modalEl = contentEl.closest(".modal") as HTMLElement;
    if (modalEl) {
      modalEl.classList.remove("cw-modal");
      const containerEl = modalEl.parentElement;
      if (containerEl) {
        containerEl.classList.remove("cw-modal-container");
      }
    }
    contentEl.empty();
  }
}
