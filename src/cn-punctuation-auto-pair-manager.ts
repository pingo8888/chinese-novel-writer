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
  "｛": "｝",
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
      if (text.length !== 1) {
        return false;
      }

      const closeChar = CN_PUNCTUATION_PAIRS[text];
      if (!closeChar) {
        return false;
      }

      const selectedText = from < to ? view.state.sliceDoc(from, to) : "";
      const hasSelection = selectedText.length > 0;
      const insertText = hasSelection
        ? `${text}${selectedText}${closeChar}`
        : `${text}${closeChar}`;
      const cursorPos = hasSelection
        ? from + insertText.length
        : from + text.length;

      view.dispatch({
        changes: { from, to, insert: insertText },
        selection: EditorSelection.cursor(cursorPos),
        scrollIntoView: true,
        userEvent: "input.type",
      });
      return true;
    });
  }
}
