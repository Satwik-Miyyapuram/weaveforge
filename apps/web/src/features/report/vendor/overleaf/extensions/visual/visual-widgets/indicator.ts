import { WidgetType } from '@codemirror/view'

export class IndicatorWidget extends WidgetType {
  constructor(public content: string) {
    super()
  }

  toDOM() {
    const element = document.createElement('span')
    element.classList.add('ol-cm-indicator')
    element.textContent = this.content
    return element
  }

  override eq(widget: IndicatorWidget) {
    return widget.content === this.content
  }

  override updateDOM(element: HTMLElement): boolean {
    element.textContent = this.content
    return true
  }

  override ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'mouseup'
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }
}
