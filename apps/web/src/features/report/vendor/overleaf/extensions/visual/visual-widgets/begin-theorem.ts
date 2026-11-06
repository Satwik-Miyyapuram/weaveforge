import { BeginWidget } from './begin'
import { EditorView } from '@codemirror/view'
import { SyntaxNode } from '@lezer/common'
import { typesetNodeIntoElement } from '../utils/typeset-content'
import { loadMathJax } from '../../../shims/load-mathjax'

export class BeginTheoremWidget extends BeginWidget {
  constructor(
    public override environment: string,
    public name: string,
    public argumentNode?: SyntaxNode | null
  ) {
    super(environment)
  }

  override toDOM(view: EditorView) {
    const element = super.toDOM(view)
    element.classList.add('ol-cm-begin-theorem')
    return element
  }

  override updateDOM(element: HTMLDivElement, view: EditorView) {
    super.updateDOM(element, view)
    element.classList.add('ol-cm-begin-theorem')
    return true
  }

  override eq(widget: BeginTheoremWidget) {
    return (
      super.eq(widget) &&
      widget.name === this.name &&
      widget.argumentNode === this.argumentNode
    )
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }

  override buildName(nameElement: HTMLSpanElement, view: EditorView) {
    nameElement.textContent = this.name
    if (this.argumentNode) {
      const suffixElement = document.createElement('span')
      typesetNodeIntoElement(this.argumentNode, suffixElement, view.state)
      nameElement.append(' (', suffixElement, ')')

      loadMathJax()
        .then(async MathJax => {
          if (!this.destroyed) {
            await MathJax.typesetPromise([nameElement])
            view.requestMeasure()
            MathJax.typesetClear([nameElement])
          }
        })
        .catch(() => {
          nameElement.classList.add('ol-cm-error')
        })
    }
  }
}
