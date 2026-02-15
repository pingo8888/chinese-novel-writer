import { Plugin } from "obsidian";
import { VIEWS, TEXTS, ICONS } from "./constants";
import ChineseWriterView from "./chinese-writer-view";

export default class ChineseWriterPlugin extends Plugin {

  async onload() {
    // 注册作家助手视图
    this.registerView(VIEWS.WRITER_HELPER, (leaf) => new ChineseWriterView(leaf));

    // 激活右边栏作家助手视图
    this.addCommand({
      id: VIEWS.WRITER_HELPER,
      name: TEXTS.OPEN_WRITER_HELPER,
      callback: () => this.activateRightView()
    });

    // 添加左边ribbon按钮
    this.addRibbonIcon(ICONS.NOTEBOOK, TEXTS.WRITER_HELPER, () => this.activateRightView());

  }

  // 插件卸载时，关闭所有作家助手视图
  async onunload(): Promise<void> {
    const existingleaves = this.app.workspace.getLeavesOfType(VIEWS.WRITER_HELPER);
    existingleaves.forEach(leaf => leaf.detach());
  }

  // 激活右边栏作家助手视图
  async activateRightView() {
    const existingleaves = this.app.workspace.getLeavesOfType(VIEWS.WRITER_HELPER);
    if (existingleaves.length > 0) {
      existingleaves.slice(1).forEach(leaf => leaf.detach());
      this.app.workspace.revealLeaf(existingleaves[0]!);
      this.app.workspace.setActiveLeaf(existingleaves[0]!);
      return;
    }
    const leaf = await this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEWS.WRITER_HELPER, active: true });
    this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf);
  }
}