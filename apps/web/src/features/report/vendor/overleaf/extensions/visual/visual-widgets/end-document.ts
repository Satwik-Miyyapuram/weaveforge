import { EditorView, WidgetType } from '@codemirror/view'
import { placeSelectionInsideBlock } from '../selection'

export class EndDocumentWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('div')
    element.classList.add('ol-cm-end-document-widget')
    element.textContent = view.state.phrase('end_of_document')
    element.addEventListener('mouseup', event => {
      event.preventDefault()
      view.dispatch(placeSelectionInsideBlock(view, event as MouseEvent))
    })
    return element
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== 'mouseup'
  }

  override eq(): boolean {
    return true
  }

  override coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }

  override get estimatedHeight() {
    return 30
  }
}
