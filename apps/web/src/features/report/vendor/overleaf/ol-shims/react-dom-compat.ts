// React 19 removed findDOMNode. Overleaf only calls it on ref values that
// react-bootstrap 2 already passes as DOM nodes, so return those as-is.
export function findDOMNode(value: unknown): Element | null {
  return value instanceof Element ? value : null
}
