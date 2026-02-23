import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type ChineseWriterPlugin from "./main";

const CN_PUNCTUATION_PAIRS: Record<string, string> = {
  "“": "”",
  "‘": "’",
  "《": "》",
  "（": "）",
  "【": "】",
  "〖": "〗",
  "〈": "〉",
  "〔": "〕",
  "「": "」",
  "『": "』",
};

export class CnPunctuationAutoPairManager {
  private plugin: ChineseWriterPlugin;

  constructor(plugin: ChineseWriterPlugin) {
    this.plugin = plugin;
  }

  createEditorExtension() {
    return EditorView.inputHandler.of((view, from, to, text) => {
      if (!this.plugin.settings.enableCnPunctuationAutoPair) {
        return false;
      }

      const closeChar = CN_PUNCTUATION_PAIRS[text];
      if (!closeChar) {
        return false;
      }

      view.dispatch({
        changes: { from, to, insert: `${text}${closeChar}` },
        selection: EditorSelection.cursor(from + text.length),
        scrollIntoView: true,
        userEvent: "input.type",
      });
      return true;
    });
  }
}
