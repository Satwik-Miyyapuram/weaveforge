import type { FileSink } from "../domain/ports";

/** `sink` seen from one folder: paths go in and come out relative to it. "" is `sink` itself. */
export function scopeSink(sink: FileSink, folder: string): FileSink {
  if (folder === "") return sink;
  const prefix = `${folder}/`;
  const into = (path: string) => (path === "" ? folder : prefix + path);
  const scoped: FileSink = {
    write: (path, data) => sink.write(into(path), data),
    list: async () => (await sink.list()).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)),
    readText: (path) => sink.readText(into(path)),
    readBytes: (path) => sink.readBytes(into(path)),
    exists: (path) => sink.exists(into(path)),
    rename: (from, to) => sink.rename(into(from), into(to)),
    remove: (path) => sink.remove(into(path)),
    writeIf: (path, text, expected) => sink.writeIf(into(path), text, expected),
  };
  if (sink.entries) {
    scoped.entries = async (dir) =>
      (await sink.entries!(into(dir))).map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
  }
  return scoped;
}
