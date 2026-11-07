// Uploads go through the workshop, not Overleaf's Uppy dashboard.
import { stub } from './stub'

type Handler = (...args: any[]) => any

type UppyOptions = {
  onBeforeFileAdded?: (file: UppyFile, files: Record<string, UppyFile>) => any
  onBeforeUpload?: (files: Record<string, UppyFile>) => any
  [key: string]: any
}

export class Uppy<_Meta = any, _Body = any> {
  constructor(_options?: UppyOptions) {
    throw new Error('Uppy is not available in the WeaveForge workshop')
  }
  use(_plugin: any, _options?: any): this {
    return this
  }
  on(_event: string, _handler: Handler): this {
    return this
  }
  off(_event: string, _handler: Handler): this {
    return this
  }
  setOptions(_options: any): void {}
  addFile(_file: any): string {
    return ''
  }
  getFile(_id: string): UppyFile {
    return undefined
  }
  getFiles(): UppyFile[] {
    return []
  }
  setFileState(_id: string, _state: any): void {}
  removeFile(_id: string): void {}
  async upload(): Promise<any> {}
  destroy(): void {}
}
export type UppyFile<_Meta = any, _Body = any> = any
export default Uppy

export const XHRUpload = stub('XHRUpload')

export function Dashboard(_props: any) {
  return null
}

export async function getDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  return Array.from(dataTransfer.files)
}
