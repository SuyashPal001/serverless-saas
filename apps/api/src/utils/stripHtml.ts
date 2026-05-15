import striptags from 'striptags';

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return striptags(html);
}
