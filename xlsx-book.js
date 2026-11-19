// =============================================================================
// Penulis Excel (.xlsx) multi-lembar tanpa library luar — untuk template &
// unduhan nilai. Mendukung: rumus, gaya per sel, gabung sel, lebar kolom,
// tinggi baris, beku panel, validasi angka, pewarnaan bersyarat, proteksi
// lembar (sel isian dibiarkan tidak terkunci), logo, tata letak cetak.
//
//   XlsxBook.build({ sheets: [{
//     name, rows, merges, widths, heights, freeze: 'E7', protect: true, showGrid: false,
//     landscape: true, fitHeight: 0, active: true,
//     validations: [{ sqref: 'E7:I40', min: 0, max: 100, title, error }],
//     conditional: [{ sqref: 'E7:I40', formula: 'ISBLANK(E7)', style: { fill: 'FEF3C7' } }],
//     logo: { png: Uint8Array, px: 44 },
//   }] }) → Uint8Array
//
// Sel: nilai (string/angka/null) atau { v, f, s }. f = rumus tanpa "=".
// s = gaya { bold, italic, underline, size, color, fill, border, align, valign, wrap, shrink, text, locked }.
// =============================================================================
(function (root) {
    'use strict';

    const RP = typeof module !== 'undefined' && module.exports ? require('./rekap-print.js') : root.RekapPrint;
    const { zipStore, colName, xmlEsc } = RP;
    const enc = new TextEncoder();
    const utf8 = (s) => enc.encode(s);

    function styleBook() {
        const fonts = ['<font><sz val="10"/><name val="Arial"/></font>'];
        const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
        const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>',
            '<border><left style="thin"><color rgb="FF94A3B8"/></left><right style="thin"><color rgb="FF94A3B8"/></right><top style="thin"><color rgb="FF94A3B8"/></top><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>'];
        const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
        const dxfs = [];
        const memo = new Map();
        const idx = (arr, xml) => { let i = arr.indexOf(xml); if (i < 0) { arr.push(xml); i = arr.length - 1; } return i; };
        const fontXml = (s) => `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}${s.underline ? '<u/>' : ''}<sz val="${s.size || 10}"/>${s.color ? `<color rgb="FF${s.color}"/>` : ''}<name val="Arial"/></font>`;
        function xf(s) {
            if (!s) return 0;
            const key = JSON.stringify(s);
            if (memo.has(key)) return memo.get(key);
            const fontId = idx(fonts, fontXml(s));
            const fillId = s.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
            const borderId = s.border ? 1 : 0;
            const numFmt = s.text ? 49 : 0;
            const al = (s.align || s.valign || s.wrap || s.shrink)
                ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''} vertical="${s.valign || 'center'}"${s.wrap ? ' wrapText="1"' : ''}${s.shrink ? ' shrinkToFit="1"' : ''}/>` : '';
            const pr = s.locked === false ? '<protection locked="0"/>' : '';
            xfs.push(`<xf numFmtId="${numFmt}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1">${al}${pr}</xf>`);
            memo.set(key, xfs.length - 1);
            return xfs.length - 1;
        }
        function dxf(s) {
            dxfs.push(`<dxf>${(s.bold || s.color) ? `<font>${s.bold ? '<b/>' : ''}${s.color ? `<color rgb="FF${s.color}"/>` : ''}</font>` : ''}${s.fill ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor rgb="FF${s.fill}"/></patternFill></fill>` : ''}</dxf>`);
            return dxfs.length - 1;
        }
        const xml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs></styleSheet>`;
        return { xf, dxf, xml };
    }

    function sheetXml(sh, st, si) {
        const rows = (sh.rows || []).map((r, ri) => {
            const cells = (r || []).map((cell, ci) => {
                if (cell === null || cell === undefined) return '';
                const c = typeof cell === 'object' ? cell : { v: cell };
                const ref = `${colName(ci)}${ri + 1}`;
                const sid = st.xf(c.s);
                const s = sid ? ` s="${sid}"` : '';
                if (c.f) return `<c r="${ref}"${s}><f>${xmlEsc(c.f)}</f></c>`;
                if (c.v === null || c.v === undefined || c.v === '') return sid ? `<c r="${ref}"${s}/>` : '';
                if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
                return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
            }).join('');
            const ht = sh.heights && sh.heights[ri + 1] ? ` ht="${sh.heights[ri + 1]}" customHeight="1"` : '';
            return cells || ht ? `<row r="${ri + 1}"${ht}>${cells}</row>` : '';
        }).join('');
        const widths = sh.widths || [];
        const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
        let pane = '';
        if (sh.freeze) {
            const m = /^([A-Z]+)(\d+)$/.exec(sh.freeze);
            const col = m[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
            const row = Number(m[2]) - 1;
            pane = `<pane${col ? ` xSplit="${col}"` : ''}${row ? ` ySplit="${row}"` : ''} topLeftCell="${sh.freeze}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${sh.freeze}" sqref="${sh.freeze}"/>`;
        }
        const merges = sh.merges || [];
        const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
        const cond = (sh.conditional || []).map((c, i) => `<conditionalFormatting sqref="${c.sqref}"><cfRule type="expression" dxfId="${st.dxf(c.style)}" priority="${i + 1}"><formula>${xmlEsc(c.formula)}</formula></cfRule></conditionalFormatting>`).join('');
        const vals = sh.validations || [];
        const dv = vals.length ? `<dataValidations count="${vals.length}">${vals.map((v) => `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="${xmlEsc(v.title || 'Nilai tidak valid')}" error="${xmlEsc(v.error || `Isi angka bulat ${v.min}–${v.max}.`)}" sqref="${v.sqref}"><formula1>${v.min}</formula1><formula2>${v.max}</formula2></dataValidation>`).join('')}</dataValidations>` : '';
        const prot = sh.protect ? '<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" sort="0" autoFilter="0"/>' : '';
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr${sh.tab ? '' : ''}><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"${sh.showGrid === false ? ' showGridLines="0"' : ''}${sh.active ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${prot}${mergeXml}${cond}${dv}<pageMargins left="0.4" right="0.4" top="0.4" bottom="0.4" header="0" footer="0"/><pageSetup paperSize="9" orientation="${sh.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="${sh.fitHeight || 0}"/>${sh.logo ? `<drawing r:id="rId1"/>` : ''}
</worksheet>`;
    }

    function build({ sheets }) {
        const st = styleBook();
        const used = new Set();
        const names = sheets.map((sh, i) => {
            let n = String(sh.name || `Lembar ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Lembar ${i + 1}`;
            let k = 2;
            while (used.has(n.toLowerCase())) n = `${n.slice(0, 27)} (${k++})`;
            used.add(n.toLowerCase());
            return n;
        });
        const activeIdx = Math.max(0, sheets.findIndex((s) => s.active));
        const files = [];
        let hasPng = false;
        sheets.forEach((sh, i) => {
            files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(sheetXml(sh, st, i)) });
            if (sh.logo && sh.logo.png) {
                hasPng = true;
                const emu = Math.round((sh.logo.px || 44) * 9525);
                files.push(
                    { name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`) },
                    { name: `xl/drawings/drawing${i + 1}.xml`, data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:ext cx="${emu}" cy="${emu}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`) },
                    { name: `xl/drawings/_rels/drawing${i + 1}.xml.rels`, data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo${i + 1}.png"/></Relationships>`) },
                    { name: `xl/media/logo${i + 1}.png`, data: sh.logo.png },
                );
            }
        });
        const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
            + (sheets[i].logo && sheets[i].logo.png ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '')).join('');
        return zipStore([
            { name: '[Content_Types].xml', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasPng ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
            { name: '_rels/.rels', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
            { name: 'xl/workbook.xml', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${activeIdx}"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`) },
            { name: 'xl/_rels/workbook.xml.rels', data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
            ...files,
            { name: 'xl/styles.xml', data: utf8(st.xml()) },
        ]);
    }

    const api = { build };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.XlsxBook = api;
}(typeof window !== 'undefined' ? window : globalThis));
