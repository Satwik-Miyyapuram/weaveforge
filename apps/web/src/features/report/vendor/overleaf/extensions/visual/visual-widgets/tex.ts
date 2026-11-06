import { WidgetType } from '@codemirror/view'

export class TeXWidget extends WidgetType {
  toDOM() {
    const element = document.createElement('span')
    element.classList.add('ol-cm-tex')
    element.innerHTML = 'T<sub>e</sub>X'
    return element
  }

  override eq() {
    return true
  }

  override ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'mouseup'
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }
}
