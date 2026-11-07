// Overleaf is written against React 18's types; we run React 19. These bring
// back the two React 18 type forms its code relies on. Runtime is unchanged.
import type { ReactElement, RefObject } from 'react'

declare module 'react' {
  // React 18 allowed useRef() with no initial value.
  function useRef<T = undefined>(): RefObject<T | undefined>
}

declare global {
  // React 18 declared JSX globally; React 19 moved it to React.JSX.
  namespace JSX {
    type Element = ReactElement
  }
}
