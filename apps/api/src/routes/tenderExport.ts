import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, BorderStyle, AlignmentType,
} from 'docx';

type TenderRow = { rfpNumber: string; title: string; department: string; budget: string | null };
type SectionRow = { sectionNo: string; title: string; blockType: string; content: unknown };

function cell(text: string, bold = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4 }, bottom: { style: BorderStyle.SINGLE, size: 4 },
      left: { style: BorderStyle.SINGLE, size: 4 }, right: { style: BorderStyle.SINGLE, size: 4 },
    },
  });
}

function headerRow(cols: string[]) {
  return new TableRow({ children: cols.map(c => cell(c, true)), tableHeader: true });
}

function sectionToElements(s: SectionRow): (Paragraph | Table)[] {
  const content = (s.content ?? {}) as Record<string, unknown>;
  const heading = new Paragraph({
    text: `${s.sectionNo}. ${s.title}`,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
  });

  if (s.blockType === 'prose') {
    const text = (content.text as string) ?? '';
    const paras = text.split('\n').filter(l => l.trim()).map(l =>
      new Paragraph({ children: [new TextRun({ text: l, size: 22 })], spacing: { after: 80 } })
    );
    return [heading, ...paras];
  }

  if (s.blockType === 'criteria-table') {
    const rows = (content.rows as Array<{ criterion: string; threshold: string; verification: string }>) ?? [];
    return [heading, new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(['Criterion', 'Threshold', 'Verification']),
        ...rows.map(r => new TableRow({ children: [cell(r.criterion), cell(r.threshold), cell(r.verification)] })),
      ],
    })];
  }

  if (s.blockType === 'spec-table') {
    const rows = (content.rows as Array<{ metric: string; target: string; measurement: string }>) ?? [];
    return [heading, new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(['Metric', 'Target', 'Measurement']),
        ...rows.map(r => new TableRow({ children: [cell(r.metric), cell(r.target), cell(r.measurement)] })),
      ],
    })];
  }

  if (s.blockType === 'line-item-table') {
    const rows = (content.rows as Array<{ slNo: number; item: string; unit: string; qty: number; remarks?: string }>) ?? [];
    return [heading, new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(['S.No', 'Item', 'Unit', 'Qty', 'Remarks']),
        ...rows.map(r => new TableRow({ children: [cell(String(r.slNo)), cell(r.item), cell(r.unit), cell(String(r.qty)), cell(r.remarks ?? '')] })),
      ],
    })];
  }

  return [heading];
}

export async function buildDocx(tender: TenderRow, sections: SectionRow[]): Promise<Buffer> {
  const children = [
    new Paragraph({
      text: tender.rfpNumber,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: tender.title, bold: true, size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: tender.department, size: 22 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    ...sections.flatMap(sectionToElements),
  ];

  const doc = new Document({
    sections: [{ properties: {}, children }],
    creator: 'Saarthi AI',
    title: tender.rfpNumber,
    description: tender.title,
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
