import { Notice, setIcon, ItemView, WorkspaceLeaf } from "obsidian";
import { VIEWS, TEXTS, ICONS, CONTAINERS } from "./constants";

type ViewNode = {
  id: string;
  name: string;
  icon: string;
  children?: ViewNode[];
}

export default class ChineseWriterView extends ItemView {

  rootDiv: HTMLDivElement;
  headerDiv: HTMLDivElement;
  dividerDiv: HTMLDivElement;
  bodyDiv: HTMLDivElement;
  MdTreeDiv: HTMLDivElement;
  headerTitleDiv: HTMLDivElement;
  iconDiv: HTMLDivElement;
  titleDiv: HTMLDivElement;
  collapseBtn: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEWS.WRITER_HELPER;
  }

  getDisplayText(): string {
    return TEXTS.WRITER_HELPER;
  }

  getIcon(): string {
    return ICONS.NOTEBOOK;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    this.contentEl.addClass(VIEWS.WRITER_HELPER);

    // 整体布局
    this.rootDiv = contentEl.createDiv({ cls: "root-container" });
    this.headerDiv = this.rootDiv.createDiv({ cls: "header-container" });
    this.dividerDiv = this.rootDiv.createDiv({ cls: "divider-container" });
    this.bodyDiv = this.rootDiv.createDiv({ cls: "body-container" });
    this.MdTreeDiv = this.bodyDiv.createDiv({ cls: "md-tree-container" });

    // 头部容器
    this.headerTitleDiv = this.headerDiv.createDiv({ cls: "header-title-container" });
    this.iconDiv = this.headerTitleDiv.createDiv({ cls: "icon-container" });
    setIcon(this.iconDiv, ICONS.NOTEBOOK);
    this.titleDiv = this.headerTitleDiv.createDiv({ cls: "title-container", text: "作家助手" });

    this.collapseBtn = this.headerDiv.createEl("button", { cls: "collapse-btn" });
    this.collapseBtn.setAttribute("data-expanded", "true");
    setIcon(this.collapseBtn, ICONS.COLLAPSE);

    // 树状结构
    for (let i = 1; i <= 5; i++) {
      const levelOneDiv = this.MdTreeDiv.createDiv({ cls: "" });
      const levelOneItem = levelOneDiv.createDiv({ cls: "level-one-item" });
      const levelOneItemIcon = levelOneItem.createSpan({ cls: "level-one-item-icon" });
      setIcon(levelOneItemIcon, ICONS.FOLDER_OPEN);
      levelOneItemIcon.setAttribute("data-expanded", "true");
      const levelOneItemText = levelOneItem.createSpan({ cls: "level-one-item-text" });
      const levelOneItemName = levelOneItemText.createSpan({ cls: "level-one-item-name", text: "角色设定" });
      const levelOneItemCounter = levelOneItemText.createSpan({ cls: "level-one-item-counter", text: "[" + 99 + "]" });
      const MdTreeDiv2 = levelOneDiv.createDiv({ cls: "md-tree-container2" });

      levelOneItemIcon.addEventListener("click", () => {
        if (levelOneItemIcon.getAttribute("data-expanded") === "false") {
          levelOneItemIcon.setAttribute("data-expanded", "true");
          setIcon(levelOneItemIcon, ICONS.FOLDER_OPEN);
          MdTreeDiv2.style.display = "block";
        } else {
          levelOneItemIcon.setAttribute("data-expanded", "false");
          setIcon(levelOneItemIcon, ICONS.FOLDER_CLOSED);
          MdTreeDiv2.style.display = "none";
        }
      });

      for (let j = 1; j <= 5; j++) {
        const levelTwoDiv = MdTreeDiv2.createDiv({ cls: "" });
        const levelTwoItem = levelTwoDiv.createDiv({ cls: "level-two-item" });
        const levelTwoItemIcon = levelTwoItem.createSpan({ cls: "level-two-item-icon" });
        setIcon(levelTwoItemIcon, ICONS.FOLDER_OPEN);
        levelTwoItemIcon.setAttribute("data-expanded", "true");

        const levelTwoItemText = levelTwoItem.createSpan({ cls: "level-two-item-text" });
        const levelTwoItemName = levelTwoItemText.createSpan({ cls: "level-two-item-name", text: "二级角色" + j });
        const levelTwoItemCounter = levelTwoItemText.createSpan({ cls: "level-two-item-counter", text: "[" + 9 + "]" });
        const MdTreeDiv3 = levelTwoDiv.createDiv({ cls: "md-tree-container3" });

        levelTwoItemIcon.addEventListener("click", () => {
          if (levelTwoItemIcon.getAttribute("data-expanded") === "false") {
            levelTwoItemIcon.setAttribute("data-expanded", "true");
            setIcon(levelTwoItemIcon, ICONS.FOLDER_OPEN);
            MdTreeDiv3.style.display = "block";
          } else {
            levelTwoItemIcon.setAttribute("data-expanded", "false");
            setIcon(levelTwoItemIcon, ICONS.FOLDER_CLOSED);
            MdTreeDiv3.style.display = "none";
          }
        });

        for (let k = 1; k <= 2; k++) {
          const levelThreeDiv = MdTreeDiv3.createDiv({ cls: "" });
          const levelThreeItem = levelThreeDiv.createDiv({ cls: "level-three-item" });
          const levelThreeItemText = levelThreeItem.createSpan({ cls: "level-three-item-text" });
          const levelThreeItemName = levelThreeItemText.createSpan({ cls: "level-three-item-name", text: "三级角色" + k });
        }
      }
    }

    this.collapseBtn.addEventListener("click", () => {

      // 全局折叠按钮处理
      if (this.collapseBtn.getAttribute("data-expanded") === "false") {
        this.collapseBtn.setAttribute("data-expanded", "true");
        setIcon(this.collapseBtn, ICONS.COLLAPSE);
      } else {
        this.collapseBtn.setAttribute("data-expanded", "false");
        setIcon(this.collapseBtn, ICONS.EXPAND);
      }
      // 二级容器折叠处理
      const MdTreeDiv2 = this.MdTreeDiv.querySelectorAll<HTMLDivElement>(".md-tree-container2");
      if (MdTreeDiv2.length === 0) return;

      MdTreeDiv2.forEach(item => {
        const levelOneItemIcon = item.parentElement?.querySelector<HTMLSpanElement>(".level-one-item-icon");
        if (!levelOneItemIcon) return;

        if (this.collapseBtn.getAttribute("data-expanded") === "true") {
          levelOneItemIcon.setAttribute("data-expanded", "true");
          setIcon(levelOneItemIcon, ICONS.FOLDER_OPEN);
          item.style.display = "block";
        } else {
          levelOneItemIcon.setAttribute("data-expanded", "false");
          setIcon(levelOneItemIcon, ICONS.FOLDER_CLOSED);
          item.style.display = "none";
        }
      });
    });
  }
}