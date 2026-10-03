import { Response } from 'express';

export function sendCsvResponse<T extends Record<string, unknown>>(
  res: Response,
  filename: string,
  data: T[]
): void {
  if (!data || data.length === 0) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send('');
    return;
  }

  const headers = Object.keys(data[0]);

  const escapeCsvValue = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows: string[] = [];
  // 1. Header row
  csvRows.push(headers.join(','));

  // 2. Data rows
  for (const row of data) {
    const values = headers.map((header) => escapeCsvValue(row[header]));
    csvRows.push(values.join(','));
  }

  const csvContent = csvRows.join('\r\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csvContent);
}