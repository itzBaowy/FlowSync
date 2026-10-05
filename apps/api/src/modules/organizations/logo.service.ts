import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { PermissionService } from '../authorization/permission.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../files/storage.module';
import { PrismaService } from '../../database/prisma.service';
import { organizationView } from './organizations.service';
@Injectable()
export class LogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  async upload(userId: string, id: string, file: Express.Multer.File | undefined) {
    const bytes = await this.normalize(file);
    const key = `organizations/${id}/logos/${randomUUID()}.png`;
    await this.storage.put(key, bytes, 'image/png');
    let previous: string | null = null;
    const organization = await this.prisma
      .$transaction(async (tx) => {
        await this.permissions.lockOrganization(tx, id);
        const actor = await this.permissions.requireOrganization(userId, id, 'update', tx);
        previous = actor.organization.logoKey;
        return tx.organization.update({ where: { id }, data: { logoKey: key } });
      })
      .catch(async (error: unknown) => {
        await this.storage.discard(key);
        throw error;
      });
    if (previous) await this.storage.discard(previous);
    return {
      ...organizationView(organization, 'OWNER'),
      logoUrl: await this.storage.signedUrl(key),
    };
  }
  private async normalize(file: Express.Multer.File | undefined): Promise<Buffer> {
    if (!file?.buffer.length) throw new BadRequestException('Choose a PNG, JPEG or WebP image');
    const types: Record<string, string> = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
    };
    try {
      const image = sharp(file.buffer, { limitInputPixels: 16777216, animated: false });
      const metadata = await image.metadata();
      if (!metadata.format || !types[metadata.format] || types[metadata.format] !== file.mimetype)
        throw new Error('Unsupported image type');
      // Decode and re-encode removes embedded metadata and bounds the output dimensions.
      return await image
        .rotate()
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException(
        'Use a valid PNG, JPEG or WebP image up to 2 MiB and 16 megapixels',
      );
    }
  }
}
