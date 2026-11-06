import { WidgetType } from '@codemirror/view'

type NoteType = 'footnote' | 'endnote'

const symbols: Record<NoteType, string> = {
  footnote: '*',
  endnote: '†',
}

export class FootnoteWidget extends WidgetType {
  constructor(private type: NoteType = 'footnote') {
    super()
  }

  toDOM() {
    const element = document.createElement('span')
    element.classList.add('ol-cm-footnote')
    element.setAttribute('role', 'button')
    element.innerHTML = symbols[this.type]
    return element
  }

  override eq(widget: FootnoteWidget) {
    return this.type === widget.type
  }

  override updateDOM(element: HTMLElement): boolean {
    element.innerHTML = symbols[this.type]
    return true
  }

  override ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'mouseup'
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }
}
