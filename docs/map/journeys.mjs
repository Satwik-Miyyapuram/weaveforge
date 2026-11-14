// Source for the docs map. `node scripts/build-map.mjs` checks every hop against the code and writes data.js.
import papers from "./journeys/papers.mjs";
import notes from "./journeys/notes.mjs";
import reader from "./journeys/reader.mjs";
import writing from "./journeys/writing.mjs";
import lab from "./journeys/lab.mjs";

export default { areas: [papers, notes, reader, writing, lab] };
