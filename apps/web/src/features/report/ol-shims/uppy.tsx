// A small stand-in for the parts of Uppy the IDE uses: the upload modal, the
// file tree's drop target and the figure modal. Files are POSTed as multipart
// through `window.fetch`, which the fetch bridge (`ol-host/fetch-bridge.ts`)
// sends on to Overleaf; the host adds the session and CSRF token.
import { useEffect, useReducer, useRef, useState, type ChangeEvent, type DragEvent } from 'react'

type Handler = (...args: any[]) => any

type Meta = Record<string, unknown>

export type UppyFile<_Meta = any, _Body = any> = any

type UppyOptions = {
  autoProceed?: boolean
  restrictions?: {
    maxNumberOfFiles?: number | null
    maxFileSize?: number | null
    allowedFileTypes?: string[] | null
  }
  onBeforeFileAdded?: (file: UppyFile, files: Record<string, UppyFile>) => any
  onBeforeUpload?: (files: Record<string, UppyFile>) => any
  [key: string]: any
}

type XhrOptions = {
  endpoint?: string
  headers?: Record<string, string | undefined>
  fieldName?: string
}

type NewFile = { name: string; type?: string; data: Blob; meta?: Meta; [key: string]: any }

export type UploadResult = { successful: UppyFile[]; failed: UppyFile[] }

/** Marks the uploader plugin in `uppy.use(XHRUpload, options)`. */
export const XHRUpload = function XHRUpload() {} as unknown as { new (...args: any[]): any }

let nextId = 0

export class Uppy<_Meta = any, _Body = any> {
  private options: UppyOptions
  private xhr: XhrOptions = {}
  private files = new Map<string, UppyFile>()
  private handlers = new Map<string, Set<Handler>>()

  constructor(options: UppyOptions = {}) {
    this.options = options
  }

  use(plugin: any, options: XhrOptions = {}): this {
    if (plugin === XHRUpload) this.xhr = options
    return this
  }

  on(event: string, handler: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return this
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  emit(event: string, ...args: any[]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args)
  }

  getState() {
    return { files: this.record() }
  }

  setOptions(options: Partial<UppyOptions>): void {
    this.options = { ...this.options, ...options }
    this.emit('state-update')
  }

  addFile(input: NewFile): string {
    const id = `wf-uppy-${++nextId}`
    const file = {
      ...input,
      id,
      name: input.name,
      type: input.type || input.data.type,
      size: input.data.size,
      extension: input.name.includes('.') ? input.name.split('.').pop() : '',
      data: input.data,
      meta: { ...input.meta, name: input.name, type: input.type || input.data.type },
      progress: { uploadComplete: false, uploadStarted: null },
    }
    const refusal = this.refusal(file)
    if (refusal) {
      this.emit('restriction-failed', file, new Error(refusal))
      throw new Error(refusal)
    }
    this.files.set(id, file)
    this.emit('file-added', file)
    this.emit('state-update')
    if (this.options.autoProceed) {
      setTimeout(() => {
        this.upload().catch(() => undefined)
      }, 0)
    }
    return id
  }

  getFile(id: string): UppyFile {
    return this.files.get(id)
  }

  getFiles(): UppyFile[] {
    return [...this.files.values()]
  }

  setFileState(id: string, state: Record<string, any>): void {
    const file = this.files.get(id)
    if (!file) return
    this.files.set(id, { ...file, ...state })
    this.emit('state-update')
  }

  removeFile(id: string): void {
    const file = this.files.get(id)
    if (!file) return
    this.files.delete(id)
    this.emit('file-removed', file)
    this.emit('state-update')
  }

  async upload(): Promise<UploadResult> {
    const waiting = this.getFiles().filter(f => !f.progress.uploadComplete)
    if (this.options.onBeforeUpload?.(this.record()) === false) {
      throw new Error('Not starting the upload because onBeforeUpload returned false')
    }
    this.emit('upload', { id: `upload-${nextId}`, fileIDs: waiting.map(f => f.id) })
    const result: UploadResult = { successful: [], failed: [] }
    for (const queued of waiting) {
      // Read again: an `upload` handler may have renamed the file or moved its endpoint.
      const file = this.files.get(queued.id) ?? queued
      if (await this.send(file)) result.successful.push(this.files.get(file.id) ?? file)
      else result.failed.push(file)
    }
    this.emit('complete', result)
    this.emit('state-update')
    return result
  }

  destroy(): void {
    this.files.clear()
    this.handlers.clear()
  }

  private record(): Record<string, UppyFile> {
    return Object.fromEntries(this.files)
  }

  private refusal(file: UppyFile): string | null {
    const { maxNumberOfFiles, maxFileSize, allowedFileTypes } = this.options.restrictions ?? {}
    if (maxNumberOfFiles && this.files.size >= maxNumberOfFiles) {
      return `You can not add more than ${maxNumberOfFiles} file${maxNumberOfFiles === 1 ? '' : 's'}`
    }
    if (maxFileSize && file.size > maxFileSize) return `${file.name} exceeds the maximum allowed size`
    if (allowedFileTypes?.length && !allowedFileTypes.some(pattern => typeMatches(file, pattern))) {
      return `${file.name}: this file type is not allowed`
    }
    if (this.options.onBeforeFileAdded?.(file, this.record()) === false) {
      return `${file.name} can not be added`
    }
    return null
  }

  /** POSTs one file; true when Overleaf took it. */
  private async send(file: UppyFile): Promise<boolean> {
    const form = new FormData()
    for (const [key, value] of Object.entries(file.meta as Meta)) {
      if (value !== undefined && value !== null) form.append(key, String(value))
    }
    form.append(this.xhr.fieldName ?? 'file', file.data, file.name)
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(this.xhr.headers ?? {})) {
      if (typeof value === 'string' && value) headers[name] = value
    }
    const endpoint = file.xhrUpload?.endpoint ?? this.xhr.endpoint ?? ''
    this.setFileState(file.id, { progress: { ...file.progress, uploadStarted: Date.now() } })
    let response: { status: number; body: any } | undefined
    try {
      const res = await globalThis.fetch(endpoint, { method: 'POST', headers, body: form })
      const text = await res.text()
      let body: any = {}
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        body = { error: text }
      }
      response = { status: res.status, body }
      if (res.ok && body.success !== false) {
        this.setFileState(file.id, {
          progress: { ...file.progress, uploadComplete: true },
          response,
        })
        this.emit('upload-success', this.files.get(file.id) ?? file, response)
        return true
      }
      throw new Error(body.error || `Upload failed (${res.status})`)
    } catch (error) {
      this.setFileState(file.id, { error: String((error as Error).message ?? error) })
      this.emit('upload-error', this.files.get(file.id) ?? file, error, response)
      return false
    }
  }
}

export default Uppy

function typeMatches(file: UppyFile, pattern: string): boolean {
  if (pattern.startsWith('.')) return file.name.toLowerCase().endsWith(pattern.toLowerCase())
  if (pattern.endsWith('/*')) return String(file.type).startsWith(pattern.slice(0, -1))
  return file.type === pattern
}

type DashboardProps = {
  uppy: Uppy
  hideUploadButton?: boolean
  showSelectedFiles?: boolean
  fileManagerSelectionType?: 'files' | 'folders' | 'both'
  height?: number
  locale?: { strings?: Record<string, string> }
  [key: string]: any
}

/** The drop area: drop, paste or pick files (or a folder) to add them. */
export function Dashboard({
  uppy,
  hideUploadButton,
  showSelectedFiles = true,
  fileManagerSelectionType = 'files',
  height,
  locale,
}: DashboardProps) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    uppy.on('state-update', rerender)
    return () => {
      uppy.off('state-update', rerender)
    }
  }, [uppy])

  const add = (list: ArrayLike<File>) => {
    setError(null)
    for (const file of Array.from(list)) {
      const relativePath = (file as any).webkitRelativePath || (file as any).relativePath || undefined
      try {
        uppy.addFile({
          name: file.name,
          type: file.type,
          data: file,
          source: 'Local',
          isRemote: false,
          meta: relativePath ? { relativePath } : {},
        })
      } catch (e) {
        setError((e as Error).message)
      }
    }
  }

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) add(event.target.files)
    event.target.value = ''
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setOver(false)
    add(event.dataTransfer.files)
  }

  const strings = locale?.strings ?? {}
  const files = uppy.getFiles()
  const waiting = files.filter(f => !f.progress.uploadComplete)
  const manual = !hideUploadButton && !(uppy as any).options.autoProceed && waiting.length > 0

  return (
    <div
      className={`uppy-Dashboard wf-uppy${over ? ' wf-uppy--over' : ''}`}
      style={{ minHeight: height ? Math.min(height, 200) : undefined }}
      onDragOver={event => {
        event.preventDefault()
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onPaste={event => add(event.clipboardData.files)}
    >
      <p className="wf-uppy-hint">Drop or paste files here, or</p>
      <div className="wf-uppy-actions">
        <button type="button" className="uppy-Dashboard-browse btn btn-secondary btn-sm" onClick={() => filesInput.current?.click()}>
          {strings.browseFiles || 'Select files'}
        </button>
        {fileManagerSelectionType !== 'files' && (
          <button type="button" className="btn btn-link btn-sm" onClick={() => folderInput.current?.click()}>
            {strings.browseFolders || 'select a folder'}
          </button>
        )}
      </div>
      <input ref={filesInput} type="file" multiple hidden onChange={onPick} />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        onChange={onPick}
        {...({ webkitdirectory: '' } as Record<string, string>)}
      />
      {error && <p className="text-danger wf-uppy-error" role="alert">{error}</p>}
      {showSelectedFiles && files.length > 0 && (
        <ul className="wf-uppy-files">
          {files.map(f => (
            <li key={f.id}>
              {f.name}{' '}
              <span className="text-muted">
                {f.error ? `failed: ${f.error}` : f.progress.uploadComplete ? 'uploaded' : f.progress.uploadStarted ? 'uploading…' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {manual && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            uppy.upload().catch(() => undefined)
          }}
        >
          Upload {waiting.length} file{waiting.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

export async function getDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  return Array.from(dataTransfer.files)
}
