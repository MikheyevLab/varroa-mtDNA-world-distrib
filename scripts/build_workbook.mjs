import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';

// Pass the repository root when running a copy of this script beside the bundled node_modules.
const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'varroa-workbook-'));
const book = await SpreadsheetFile.importXlsx(await FileBlob.load(`${root}/Data/Database_mtDNA_updated_2021.xlsx`));
const name = 'Table Data S2_Data_papers';
const sheet = book.worksheets.getItem(name);
console.log((await book.inspect({kind:'sheet', include:'id,name', maxChars:1500})).ndjson);
const before = await book.render({sheetName:name, range:'A929:H932', scale:1, format:'png'});
await fs.writeFile(path.join(scratch, 'before.png'), new Uint8Array(await before.arrayBuffer()));
console.log('Baseline preview saved.');
if (process.argv.includes('--inspect-only')) process.exit(0);

const rows = JSON.parse(await fs.readFile(`${root}/Data/updates/2026-11-05/workbook_rows.json`, 'utf8'));
// Extend the source layout only into the appended rows, then replace copied cell values.
for (let i=0; i<rows.length; i++) sheet.getRange(`A${933+i}:S${933+i}`).copyFrom(sheet.getRange('A932:S932'), 'all');
sheet.getRange('A933:S1059').values = rows;
sheet.getRange('A933:S1059').format.wrapText = true;
sheet.getRange('A933:S1059').format.autofitRows();
book.recalculate();
console.log((await book.inspect({kind:'table',range:`'${name}'!A933:P934`,include:'values,formulas',tableMaxRows:2,tableMaxCols:16,maxChars:3000})).ndjson);
console.log((await book.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:10},maxChars:1000})).ndjson);
for (const [label,range] of [['after','A933:H936'],['coordinates','J933:P934'],['notes','Q933:Q934']]) {
  const image = await book.render({sheetName:name,range,scale:1,format:'png'});
  await fs.writeFile(path.join(scratch, `${label}.png`),new Uint8Array(await image.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(book)).save(path.join(scratch, 'authored.xlsx'));
// Preserve historical formatting and native Excel features that the export normalizes.
execFileSync('python3', [path.join(root, 'scripts/preserve_workbook_baseline.py'), path.join(scratch, 'authored.xlsx')], {stdio:'inherit'});
console.log(`Exported the 2026 workbook. Review images: ${scratch}`);
