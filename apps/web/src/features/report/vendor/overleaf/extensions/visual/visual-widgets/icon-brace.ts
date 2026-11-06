import { WidgetType } from '@codemirror/view'

export class IconBraceWidget extends WidgetType {
  constructor(private content = '') {
    super()
  }

  toDOM() {
    const element = document.createElement('span')
    element.classList.add('ol-cm-brace')
    element.classList.add('ol-cm-icon-brace')
    element.textContent = this.content
    return element
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown' && event.type !== 'mouseup'
  }

  override eq(widget: IconBraceWidget) {
    return widget.content === this.content
  }

  override updateDOM(element: HTMLElement): boolean {
    element.textContent = this.content
    return true
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }
}
