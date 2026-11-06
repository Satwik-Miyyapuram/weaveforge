import { WidgetType } from '@codemirror/view'

export class BraceWidget extends WidgetType {
  constructor(private content = '') {
    super()
  }

  toDOM() {
    const element = document.createElement('span')
    element.classList.add('ol-cm-brace')
    element.textContent = this.content
    return element
  }

  override ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'mouseup'
  }

  override eq(widget: BraceWidget) {
    return widget.content === this.content
  }

  override updateDOM(element: HTMLSpanElement): boolean {
    element.textContent = this.content
    return true
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }
}
