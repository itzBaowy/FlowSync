import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  validateAttachment,
  MAX_ATTACHMENT_SIZE,
} from '../src/modules/files/attachment-validation';
import { zipFixture } from './helpers/zip-fixture';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const file = (buffer: Buffer, mimetype: string, originalname = 'upload') =>
  ({ buffer, mimetype, originalname }) as Express.Multer.File;
describe('bounded attachment validation', () => {
  it('decodes valid images and rejects MIME spoofing, unsupported and oversized files', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    expect((await validateAttachment(file(png, 'image/png', 'photo.png'))).mimeType).toBe(
      'image/png',
    );
    await expect(validateAttachment(file(png, 'image/jpeg'))).rejects.toThrow('valid PNG');
    await expect(
      validateAttachment(file(Buffer.from('<script>bad</script>'), 'image/png')),
    ).rejects.toThrow();
    await expect(
      validateAttachment(file(Buffer.alloc(MAX_ATTACHMENT_SIZE + 1), 'application/pdf')),
    ).rejects.toThrow('10 MiB');
    await expect(validateAttachment(file(Buffer.from('hello'), 'text/html'))).rejects.toThrow();
  });
  it('checks PDF boundaries and sanitizes path/control characters in names', async () => {
    const bytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    expect(
      (await validateAttachment(file(bytes, 'application/pdf', '..\\reports/notes\r\n.pdf')))
        .filename,
    ).toBe('notes.pdf');
    await expect(
      validateAttachment(file(Buffer.from('%PDF-1.7 incomplete'), 'application/pdf')),
    ).rejects.toThrow();
  });
  it('checks ZIP structure, traversal, encryption and declared expansion limits', async () => {
    expect(
      (
        await validateAttachment(
          file(zipFixture([{ name: 'notes.txt', text: 'hello' }]), 'application/zip'),
        )
      ).mimeType,
    ).toBe('application/zip');
    for (const entries of [
      [{ name: '../outside', text: 'bad' }],
      [{ name: 'locked', text: 'bad', flags: 1 }],
      [{ name: 'large', text: 'x', expandedSize: 101 * 1024 * 1024 }],
    ])
      await expect(
        validateAttachment(file(zipFixture(entries), 'application/zip')),
      ).rejects.toThrow();
    await expect(
      validateAttachment(file(Buffer.from('PK fake archive'), 'application/zip')),
    ).rejects.toThrow();
  });
  it('requires a DOCX package and rejects macros', async () => {
    const entries = [
      {
        name: '[Content_Types].xml',
        text: '<Types>application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml</Types>',
      },
      { name: 'word/document.xml', text: '<document />' },
      { name: '_rels/.rels', text: '<Relationships />' },
    ];
    expect((await validateAttachment(file(zipFixture(entries), DOCX))).mimeType).toBe(DOCX);
    await expect(
      validateAttachment(file(zipFixture([{ name: 'notes.txt', text: 'not DOCX' }]), DOCX)),
    ).rejects.toThrow();
    await expect(
      validateAttachment(
        file(zipFixture([...entries, { name: 'word/vbaProject.bin', text: 'macro' }]), DOCX),
      ),
    ).rejects.toThrow();
  });
});
