// Lists of files, as the panels show them: the folder in grey, then the name.
import { esc } from "./util.js";

export function createLists(data) {
  const fileLink = (i, extra = "") => {
    const p = data.files[i].path;
    const k = p.lastIndexOf("/");
    return `<li><button data-file="${i}"><span class="dir">${esc(p.slice(0, k + 1))}&lrm;</span>${esc(p.slice(k + 1))}${extra}</button></li>`;
  };

  // A titled section with a count; colour is a CSS colour for the small square before the title.
  const list = (title, items, colour, empty = "None") =>
    `<section><h3>${colour ? `<i style="background:${colour}"></i>` : ""}${title} <span class="n">${items.length}</span></h3>` +
    (items.length ? `<ul class="files">${items.join("")}</ul>` : `<p class="muted">${empty}</p>`) +
    `</section>`;

  // Files, folded after the first eight; nothing at all when empty.
  const fileList = (title, ids, colour) => {
    if (!ids.length) return "";
    if (ids.length <= 10) return list(title, ids.map((x) => fileLink(x)), colour);
    return `<section><h3><i style="background:${colour}"></i>${title} <span class="n">${ids.length}</span></h3>` +
      `<ul class="files">${ids.slice(0, 8).map((x) => fileLink(x)).join("")}</ul>` +
      `<details><summary>${ids.length - 8} more</summary><ul class="files">${ids.slice(8).map((x) => fileLink(x)).join("")}</ul></details></section>`;
  };

  return { fileLink, list, fileList };
}
