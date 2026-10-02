/* table-shape.mjs: a table is a grid a reader scans in two directions, not a container for facts.
 *
 * THE DEFECT. A comparison band that is not a comparison. It fails in ways a table can express and
 * a human never would, and all of them render perfectly: nothing overflows, nothing clips, no
 * contrast fails, no label truncates. Eleven pages carried one and every check passed all eleven.
 *
 *   B  THE ROW LABEL IS A SENTENCE. A label column printed a register's one-line DESCRIPTION of a
 *      fact, written for a JSON file and up to forty words long. It landed in a 15rem sticky first
 *      column and wrapped to ten lines beside an 800px cell holding eight words.
 *   C  THE ROW SPANS EVERY DATA COLUMN. A cell covering the whole grid is one FACT, not a
 *      comparison, and a comparison table is the worst container there is for a fact. Six of one
 *      page's seven rows were that shape, so the comparison was a glossary wearing a comparison's
 *      markup.
 *   D  THE TABLE HAS ONE DATA COLUMN. Nothing is compared against anything, so the table
 *      contributes only a sticky label track that squeezes every value into a strip. One page
 *      shipped twelve rows of exactly this.
 *
 * IT READS THE RENDERED TABLE, so the same defect reached through any indirection, a CMS field, a
 * markdown pipeline, a helper, is still caught, and it covers pages whose source is not on this
 * machine.
 *
 * THE QUALIFIERS ARE WHAT MAKE THE RULES SAFE, and each was measured against a real page before it
 * was written. A row with no `<th scope=row>` is an empty state, not a comparison, so none of the
 * "nothing here yet" rows anywhere is touched. A spanning cell with another cell after it is a
 * summary row, which is correct. And rule D is a MEDIAN test rather than a maximum: a two-column
 * parameter reference is name to one clause and reads perfectly as a table, and forcing those into
 * a list would be the rule inventing a problem. What does not read is a paragraph per row with a
 * label track beside it, so one long row in an otherwise short table is not a finding.
 */

export const id = "table-shape";
export const title = "table shape";
export const scope = 'width';
export const summary =
  "A table whose rows are facts rather than comparable values: a sentence in the label column, a " +
  "row spanning the whole grid, or a single data column.";

/* A row label is navigation. Sixty-four characters is already a long one: the longest legitimate
 * label measured after the fix was 40 characters, and the shortest offender was 34 characters read
 * out of a register rather than authored. The cutoff catches sentences, not long labels. */
export const MAX_LABEL = 64;
/* FOUR ROWS IS THE FLOOR FOR RULE D, and it is not arbitrary: a two-row key/value block beside a
 * figure is a caption, not a list, and reporting those would make the rule noise. */
export const MIN_ROWS = 4;
/* AND LENGTH IS WHAT MAKES IT A WALL. A parameter reference is name to one clause. A paragraph per
 * row with a label track beside it is the thing. 80 characters is roughly one printed line at the
 * measure these cells get. */
export const MAX_MEDIAN = 80;

export function probeTableShape(K) {
  const { MAX_LABEL, MIN_ROWS, MAX_MEDIAN } = K;
  const out = [];
  const text = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const sel = (el) => {
    const c =
      typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "");
  };

  for (const table of document.querySelectorAll("table")) {
    if (!table.getClientRects().length) continue;
    const where = (
      table.querySelector("caption")?.innerText ||
      table.closest("section,article")?.querySelector("h1,h2,h3")?.innerText ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const cols = table.querySelectorAll("thead th[scope=col], thead th").length;

    for (const th of table.querySelectorAll("th[scope=row]")) {
      const t = text(th);
      if (t.length > MAX_LABEL) {
        out.push({
          rule: "B",
          sel: sel(th),
          where,
          chars: t.length,
          text: t.slice(0, 120),
          what: `row label is ${t.length} characters, over ${MAX_LABEL}. A label column the reader cannot scan is not a label column`,
          fix: "author a two to four word term on the row and move the sentence into the cell it belongs to",
        });
      }
    }

    for (const tr of table.querySelectorAll("tbody tr")) {
      if (!tr.querySelector("th[scope=row]")) continue; // an empty state carries no row header
      const cells = [...tr.children];
      const last = cells[cells.length - 1];
      if (!last || last.tagName !== "TD") continue; // a banding <th colspan> is a heading
      const span = Number(last.getAttribute("colspan") || 1);
      if (span < 2 || (cols && span < cols - 1)) continue; // spans some columns, not the grid
      const t = text(last);
      if (t.length < 24) continue; // an empty state, a dash, a note
      out.push({
        rule: "C",
        sel: sel(tr),
        where,
        span,
        cols,
        text: t.slice(0, 120),
        what: `row spans every data column (colspan=${span} of ${cols || "?"}). One value across the whole grid is a FACT, not a comparison`,
        fix: "move it out of the table into a label and value list; leave the table to rows that actually differ by column",
      });
    }

    /* A two-column table whose first column is the row label has no grid to scan: it is a
     * definition list wearing a table's markup. */
    const body = [...table.querySelectorAll("tbody tr")];
    const twoCol =
      body.length >= MIN_ROWS && body.every((tr) => tr.children.length === 2 && tr.children[0].tagName === "TH");
    if (twoCol) {
      const lens = body.map((tr) => text(tr.children[1]).length).sort((a, b) => a - b);
      const median = lens[Math.floor(lens.length / 2)];
      if (median > MAX_MEDIAN) {
        out.push({
          rule: "D",
          sel: sel(table),
          where,
          rows: body.length,
          median,
          text: text(body[0].children[0]).slice(0, 120),
          what:
            `table has one data column and a ${median}-character median value, over ${MAX_MEDIAN}. Nothing is ` +
            `compared against anything, so the table contributes only a sticky label track`,
          fix: "render it as a label and value list; a table is for a grid a reader scans in two directions",
        });
      }
    }
  }
  return out;
}

export const K = { MAX_LABEL, MIN_ROWS, MAX_MEDIAN };

export async function run({ page, inPage }) {
  const rows = await inPage(page, probeTableShape, K);
  return {
    findings: rows.map((f) => ({
      sel: f.sel,
      msg: `[rule ${f.rule}] ${f.what}. ${f.where ? f.where + ": " : ""}"${f.text}". Fix: ${f.fix}`,
      measured: f,
    })),
    notes: [],
  };
}
