// Types only, for tsc. The bundle uses Overleaf's vim fork in ../codemirror/vim
// (next.config.mjs aliases it). The fork's own JS types do not emit cleanly,
// so the vendored callers see this loose surface instead.
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export declare class CodeMirror {
  static commands: Record<string, (cm: CodeMirror) => void>
  static Pos: new (line: number, ch: number) => { line: number; ch: number }
  cm6: EditorView
  getSelections(): string[]
  [key: string]: any
}
export declare const Vim: any
export declare function vim(options?: { status?: boolean }): Extension
export declare function getCM(view: EditorView): CodeMirror | null
