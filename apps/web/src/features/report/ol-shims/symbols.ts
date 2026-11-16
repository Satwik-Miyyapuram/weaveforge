// Overleaf's symbol palette is a paid module; the palette stays empty.
export type SymbolWithCharacter = {
  category: string
  command: string
  description: string
  notes: string
  character: string
}

const symbols: SymbolWithCharacter[] = []
export default symbols
