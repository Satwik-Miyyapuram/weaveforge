// Stand-in for Overleaf's proprietary history library (not shipped).
// Only the shapes the vendored callers need are typed.
import { stub } from '../stub'

// An empty project. The IDE builds one up front; it fills only from the
// history service, which the workshop does not use.
export class Snapshot {
  [key: string]: any
  getFilePathnames(): string[] {
    return []
  }
  getFile(_path: string): any {
    return undefined
  }
}
export class StringFileData extends stub('StringFileData') {
  static fromRaw(_raw: any): StringFileData {
    return new StringFileData()
  }
}
export class Range extends stub('Range') {
  declare pos: number
  declare end: number
}
export class TrackedChangeList extends stub('TrackedChangeList') {
  static fromRaw(_raw: any): TrackedChangeList {
    return new TrackedChangeList()
  }
}
export const TrackingProps = stub('TrackingProps')
export type TrackingProps = InstanceType<typeof TrackingProps>
type Comment = { id: string; resolved: boolean; ranges: Range[] }
export class CommentList extends stub('CommentList') {
  override *[Symbol.iterator](): Iterator<Comment> {}
}

export class EditOperation extends stub('EditOperation') {
  canBeComposedWith(_other: EditOperation): boolean {
    return false
  }
  compose(_other: EditOperation): EditOperation {
    return this
  }
}
// Subclasses carry their own brand so `instanceof` chains narrow correctly.
export class TextOperation extends EditOperation {
  declare readonly __op: 'TextOperation'
}
export class AddCommentOperation extends EditOperation {
  declare readonly __op: 'AddCommentOperation'
}
export class DeleteCommentOperation extends EditOperation {
  declare readonly __op: 'DeleteCommentOperation'
}
export class SetCommentStateOperation extends EditOperation {
  declare readonly __op: 'SetCommentStateOperation'
}
export class EditOperationBuilder extends stub('EditOperationBuilder') {
  static fromJSON(_raw: any): EditOperation {
    return new EditOperation()
  }
}
export const EditOperationTransformer = stub('EditOperationTransformer')
export type EditOperationTransformer = InstanceType<typeof EditOperationTransformer>
export const InsertOp = stub('InsertOp')
export type InsertOp = InstanceType<typeof InsertOp>
export const RemoveOp = stub('RemoveOp')
export type RemoveOp = InstanceType<typeof RemoveOp>
export const RetainOp = stub('RetainOp')
export type RetainOp = InstanceType<typeof RetainOp>
// The IDE subclasses this up front with its own fetchString; nothing else is read.
export class BlobStoreBase {
  [key: string]: any
}
export class Change extends stub('Change') {
  static fromRaw(_raw: any): Change | null {
    return null
  }
}
export class Chunk extends stub('Chunk') {
  static fromRaw(_raw: any): Chunk {
    return new Chunk()
  }
}
export const File = stub('File')
export type File = InstanceType<typeof File>
