/* =====================================================================
   Notes Gallery — minimal PDF writer
   ---------------------------------------------------------------------
   Builds real vector PDFs with no dependencies: pages, text (Helvetica),
   rectangles, paths, JPEG images, transparency and internal page links.

   Everything here takes TOP-LEFT coordinates in points; the y axis is
   flipped on the way into the PDF so callers can think in screen terms.
   ===================================================================== */
(function () {
  'use strict';

  // Standard Helvetica advance widths (1/1000 em) for ASCII 32..126.
  const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  const charW = (c, bold) => {
    const i = c.charCodeAt(0) - 32;
    const t = bold ? W_BOLD : W_REG;
    return (i >= 0 && i < t.length ? t[i] : 556) / 1000;
  };
  function textWidth(s, size, bold) {
    let w = 0;
    for (const ch of String(s)) w += charW(ch, bold);
    return w * size;
  }
  // PDF text strings are Latin-1; drop anything that cannot be shown.
  function pdfString(s) {
    let out = '';
    for (const ch of String(s)) {
      const c = ch.charCodeAt(0);
      if (c === 40 || c === 41 || c === 92) out += '\\' + ch;       // ( ) \
      else if (c >= 32 && c <= 126) out += ch;
      else if (c === 9) out += ' ';
      else if (c > 126 && c < 256) out += '\\' + c.toString(8).padStart(3, '0');
      else out += '?';
    }
    return out;
  }
  // Wrap text to a width, honouring existing newlines.
  function wrapText(s, size, bold, maxW) {
    const lines = [];
    for (const para of String(s == null ? '' : s).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const next = line ? line + ' ' + word : word;
        if (textWidth(next, size, bold) <= maxW || !line) line = next;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  const hex2rgb = (hex) => {
    const h = String(hex || '#000').replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
    return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
  };
  const n = (v) => (Math.round(v * 100) / 100).toString();

  function createDoc(opts) {
    const W = opts.width, H = opts.height;
    const pages = [];
    const images = [];                 // { bytes, w, h, id }
    const alphas = new Set([1]);       // ExtGState alpha values in use

    function page() {
      const ops = [];
      const links = [];
      const used = new Set();
      const Y = (y) => H - y;          // top-left -> PDF bottom-left

      const api = {
        _ops: ops, _links: links, _images: used,

        rect(x, y, w, h, o) {
          o = o || {};
          if (o.opacity != null && o.opacity < 1) { alphas.add(o.opacity); ops.push('/GS' + String(o.opacity).replace('.', '_') + ' gs'); }
          if (o.fill) { const c = hex2rgb(o.fill); ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} rg`); }
          if (o.stroke) { const c = hex2rgb(o.stroke); ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} RG`); }
          ops.push(n(o.lineWidth || 1) + ' w');
          const r = Math.min(o.radius || 0, w / 2, h / 2);
          if (r > 0) {
            const k = r * 0.5523;
            const x0 = x, x1 = x + w, y0 = Y(y), y1 = Y(y + h);
            ops.push(`${n(x0 + r)} ${n(y0)} m`);
            ops.push(`${n(x1 - r)} ${n(y0)} l`);
            ops.push(`${n(x1 - r + k)} ${n(y0)} ${n(x1)} ${n(y0 - r + k)} ${n(x1)} ${n(y0 - r)} c`);
            ops.push(`${n(x1)} ${n(y1 + r)} l`);
            ops.push(`${n(x1)} ${n(y1 + r - k)} ${n(x1 - r + k)} ${n(y1)} ${n(x1 - r)} ${n(y1)} c`);
            ops.push(`${n(x0 + r)} ${n(y1)} l`);
            ops.push(`${n(x0 + r - k)} ${n(y1)} ${n(x0)} ${n(y1 + r - k)} ${n(x0)} ${n(y1 + r)} c`);
            ops.push(`${n(x0)} ${n(y0 - r)} l`);
            ops.push(`${n(x0)} ${n(y0 - r + k)} ${n(x0 + r - k)} ${n(y0)} ${n(x0 + r)} ${n(y0)} c`);
          } else {
            ops.push(`${n(x)} ${n(Y(y + h))} ${n(w)} ${n(h)} re`);
          }
          ops.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
          if (o.opacity != null && o.opacity < 1) ops.push('/GS1 gs');
          return api;
        },

        // points: [[x,y], ...] in top-left space
        path(points, o) {
          o = o || {};
          if (!points || points.length < 2) return api;
          if (o.opacity != null && o.opacity < 1) { alphas.add(o.opacity); ops.push('/GS' + String(o.opacity).replace('.', '_') + ' gs'); }
          if (o.fill) { const c = hex2rgb(o.fill); ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} rg`); }
          if (o.stroke) { const c = hex2rgb(o.stroke); ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} RG`); }
          ops.push(n(o.width || 1) + ' w');
          ops.push('1 J 1 j');                                  // round caps + joins
          if (o.dash) ops.push('[' + o.dash + '] 0 d'); else ops.push('[] 0 d');
          ops.push(`${n(points[0][0])} ${n(Y(points[0][1]))} m`);
          if (o.smooth && points.length > 2) {
            for (let i = 1; i < points.length - 1; i++) {
              const mx = (points[i][0] + points[i + 1][0]) / 2, my = (points[i][1] + points[i + 1][1]) / 2;
              ops.push(`${n(points[i][0])} ${n(Y(points[i][1]))} ${n(mx)} ${n(Y(my))} v`);
            }
            const l = points[points.length - 1];
            ops.push(`${n(l[0])} ${n(Y(l[1]))} l`);
          } else {
            for (let i = 1; i < points.length; i++) ops.push(`${n(points[i][0])} ${n(Y(points[i][1]))} l`);
          }
          if (o.closed) ops.push('h');
          ops.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
          if (o.opacity != null && o.opacity < 1) ops.push('/GS1 gs');
          return api;
        },

        ellipse(cx, cy, rx, ry, o) {
          o = o || {};
          const k = 0.5523;
          const y = Y(cy);
          if (o.fill) { const c = hex2rgb(o.fill); ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} rg`); }
          if (o.stroke) { const c = hex2rgb(o.stroke); ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} RG`); }
          ops.push(n(o.lineWidth || 1) + ' w');
          ops.push(`${n(cx - rx)} ${n(y)} m`);
          ops.push(`${n(cx - rx)} ${n(y + ry * k)} ${n(cx - rx * k)} ${n(y + ry)} ${n(cx)} ${n(y + ry)} c`);
          ops.push(`${n(cx + rx * k)} ${n(y + ry)} ${n(cx + rx)} ${n(y + ry * k)} ${n(cx + rx)} ${n(y)} c`);
          ops.push(`${n(cx + rx)} ${n(y - ry * k)} ${n(cx + rx * k)} ${n(y - ry)} ${n(cx)} ${n(y - ry)} c`);
          ops.push(`${n(cx - rx * k)} ${n(y - ry)} ${n(cx - rx)} ${n(y - ry * k)} ${n(cx - rx)} ${n(y)} c`);
          ops.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
          return api;
        },

        // y is the text baseline top; returns the y after the drawn block
        text(str, x, y, o) {
          o = o || {};
          const size = o.size || 10, bold = !!o.bold;
          const c = hex2rgb(o.color || '#111');
          const lines = o.maxWidth ? wrapText(str, size, bold, o.maxWidth) : [String(str == null ? '' : str)];
          const max = o.maxLines || lines.length;
          const lh = o.lineHeight || size * 1.28;
          let ty = y + size;                                    // baseline of line 1
          ops.push('BT');
          ops.push(`/${bold ? 'F2' : 'F1'} ${n(size)} Tf`);
          ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} rg`);
          for (let i = 0; i < Math.min(lines.length, max); i++) {
            let line = lines[i];
            if (i === max - 1 && lines.length > max) {          // clipped: mark it
              while (line && textWidth(line + '...', size, bold) > (o.maxWidth || 1e9)) line = line.slice(0, -1);
              line += '...';
            }
            let tx = x;
            if (o.align === 'center') tx = x + ((o.maxWidth || 0) - textWidth(line, size, bold)) / 2;
            else if (o.align === 'right') tx = x + (o.maxWidth || 0) - textWidth(line, size, bold);
            ops.push(`1 0 0 1 ${n(tx)} ${n(Y(ty))} Tm`);
            ops.push(`(${pdfString(line)}) Tj`);
            ty += lh;
          }
          ops.push('ET');
          return ty - size;
        },

        image(img, x, y, w, h) {                                // img from addImage()
          used.add(img.id);
          ops.push('q');
          ops.push(`${n(w)} 0 0 ${n(h)} ${n(x)} ${n(Y(y + h))} cm`);
          ops.push(`/Im${img.id} Do`);
          ops.push('Q');
          return api;
        },

        link(x, y, w, h, pageIndex) { links.push({ x, y, w, h, page: pageIndex }); return api; },
        _rectY: Y,
      };
      pages.push(api);
      return api;
    }

    // JPEG bytes -> reusable image handle
    function addImage(bytes, w, h) {
      const img = { id: images.length + 1, bytes, w, h };
      images.push(img);
      return img;
    }

    function build() {
      const chunks = [];
      let len = 0;
      const enc = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
      const push = (data) => { const b = typeof data === 'string' ? enc(data) : data; chunks.push(b); len += b.length; };

      // object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, then images,
      // then per page: [page, content, ...annots]
      const objs = [];                                   // index -> {offset}
      const alphaList = [...alphas].filter(a => a < 1);
      const nImg = images.length;
      const firstImgObj = 5;
      const firstAlphaObj = firstImgObj + nImg;
      const firstPageObj = firstAlphaObj + alphaList.length;
      const perPage = [];
      let objNo = firstPageObj;
      pages.forEach((p) => {
        const rec = { page: objNo++, content: objNo++, annots: [] };
        p._links.forEach(() => rec.annots.push(objNo++));
        perPage.push(rec);
      });

      const offsets = {};
      const beginObj = (num) => { offsets[num] = len; push(`${num} 0 obj\n`); };
      const endObj = () => push('endobj\n');

      push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

      beginObj(1); push(`<</Type/Catalog/Pages 2 0 R>>\n`); endObj();
      beginObj(2);
      push(`<</Type/Pages/Count ${pages.length}/Kids[${perPage.map(r => r.page + ' 0 R').join(' ')}]>>\n`);
      endObj();
      beginObj(3); push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>\n'); endObj();
      beginObj(4); push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>\n'); endObj();

      images.forEach((img, i) => {
        beginObj(firstImgObj + i);
        push(`<</Type/XObject/Subtype/Image/Width ${img.w}/Height ${img.h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${img.bytes.length}>>\nstream\n`);
        push(img.bytes);
        push('\nendstream\n');
        endObj();
      });
      alphaList.forEach((a, i) => {
        beginObj(firstAlphaObj + i);
        push(`<</Type/ExtGState/ca ${a}/CA ${a}>>\n`);
        endObj();
      });

      const gsRes = ['/GS1 <</Type/ExtGState/ca 1/CA 1>>']
        .concat(alphaList.map((a, i) => `/GS${String(a).replace('.', '_')} ${firstAlphaObj + i} 0 R`)).join(' ');

      pages.forEach((p, pi) => {
        const rec = perPage[pi];
        const imgRes = [...p._images].map(id => `/Im${id} ${firstImgObj + id - 1} 0 R`).join(' ');
        beginObj(rec.page);
        push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${n(W)} ${n(H)}]` +
             `/Resources<</Font<</F1 3 0 R/F2 4 0 R>>` +
             (imgRes ? `/XObject<<${imgRes}>>` : '') +
             `/ExtGState<<${gsRes}>>>>` +
             `/Contents ${rec.content} 0 R` +
             (rec.annots.length ? `/Annots[${rec.annots.map(a => a + ' 0 R').join(' ')}]` : '') +
             `>>\n`);
        endObj();

        const stream = p._ops.join('\n');
        beginObj(rec.content);
        push(`<</Length ${stream.length}>>\nstream\n`);
        push(stream);
        push('\nendstream\n');
        endObj();

        p._links.forEach((lk, li) => {
          const target = perPage[lk.page];
          if (!target) return;
          beginObj(rec.annots[li]);
          push(`<</Type/Annot/Subtype/Link/Border[0 0 0]/Rect[${n(lk.x)} ${n(H - lk.y - lk.h)} ${n(lk.x + lk.w)} ${n(H - lk.y)}]` +
               `/Dest[${target.page} 0 R /XYZ 0 ${n(H)} 0]>>\n`);
          endObj();
        });
      });

      const maxObj = objNo - 1;
      const xrefAt = len;
      push(`xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`);
      for (let i = 1; i <= maxObj; i++) {
        push(String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n');
      }
      push(`trailer\n<</Size ${maxObj + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`);

      const all = new Uint8Array(len);
      let at = 0;
      for (const c of chunks) { all.set(c, at); at += c.length; }
      return all;
    }

    return { page, addImage, build, width: W, height: H, textWidth, wrapText };
  }

  window.NGPdf = { createDoc, textWidth, wrapText };
})();
