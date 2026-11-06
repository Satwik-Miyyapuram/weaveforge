import { WidgetType } from '@codemirror/view'

export class EndWidget extends WidgetType {
  toDOM() {
    const element = document.createElement('div')
    element.classList.add('ol-cm-end')
    return element
  }

  override eq() {
    return true
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }
}
