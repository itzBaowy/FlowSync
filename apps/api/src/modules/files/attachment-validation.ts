import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { fromBufferPromise } from 'yauzl';
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function validateZip(bytes: Buffer, docx: boolean) {
  const archive = await fromBufferPromise(bytes, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  try {
    if (archive.entryCount > 1000) throw new Error('Too many archive entries');
    const names = new Set<string>();
    let total = 0;
    let manifest = '';
    for await (const entry of archive.eachEntry()) {
      total += entry.uncompressedSize;
      if (
        total > 100 * 1024 * 1024 ||
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod) ||
        names.has(entry.fileName)
      )
        throw new Error('Unsafe archive');
      names.add(entry.fileName);
      if (docx && /vbaProject\.bin$/i.test(entry.fileName))
        throw new Error('Macros are not supported');
      if (docx && entry.fileName === '[Content_Types].xml') {
        if (entry.uncompressedSize > 65536) throw new Error('Manifest too large');
        const stream = await archive.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > 65536) {
            stream.destroy();
            throw new Error('Manifest too large');
          }
          chunks.push(chunk);
        }
        manifest = Buffer.concat(chunks).toString('utf8');
      }
    }
    if (
      docx &&
      (!names.has('word/document.xml') ||
        !names.has('_rels/.rels') ||
        !manifest.includes(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        ))
    )
      throw new Error('Invalid DOCX package');
  } finally {
    archive.close();
  }
}
export async function validateAttachment(file: Express.Multer.File | undefined) {
  if (!file?.buffer.length || file.buffer.length > MAX_ATTACHMENT_SIZE)
    throw new BadRequestException('Choose a supported file up to 10 MiB');
  const bytes = file.buffer;
  try {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      const image = sharp(bytes, { limitInputPixels: 16777216, animated: false });
      const metadata = await image.metadata();
      const types: Record<string, string> = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      };
      if (!metadata.format || types[metadata.format] !== file.mimetype)
        throw new Error('MIME mismatch');
      await image.resize(1, 1).toBuffer();
    } else if (file.mimetype === 'application/pdf') {
      if (
        !/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(bytes.subarray(0, 9).toString('ascii')) ||
        !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
      )
        throw new Error('Invalid PDF');
    } else if (file.mimetype === 'application/zip' || file.mimetype === DOCX) {
      await validateZip(bytes, file.mimetype === DOCX);
    } else throw new Error('Unsupported MIME');
  } catch {
    throw new BadRequestException('Use a valid PNG, JPEG, WebP, PDF, DOCX or ZIP up to 10 MiB');
  }
  const filename = file.originalname
    .normalize('NFC')
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\p{Cc}/gu, '')
    .trim();
  if (!filename || filename.length > 255 || filename === '.' || filename === '..')
    throw new BadRequestException('Use a filename between 1 and 255 characters');
  return { bytes, filename, mimeType: file.mimetype };
}
