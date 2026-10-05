import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export function mentionTokens(text: string) {
  const ids = [
    ...new Set(
      [...text.matchAll(/@\[[^\]\r\n]{1,80}\]\(([0-9a-f-]{36})\)/gi)].map((match) =>
        match[1]!.toLowerCase(),
      ),
    ),
  ];
  const handles = [
    ...new Set(
      [...text.matchAll(/(?:^|\s)@([\p{L}\p{N}_.+-]+(?:@[\p{L}\p{N}.-]+)?)/gu)].map((match) =>
        match[1]!.toLowerCase(),
      ),
    ),
  ];
  if (
    ids.some((id) => !z.string().uuid().safeParse(id).success) ||
    ids.length + handles.length > 20
  )
    throw new BadRequestException('Use at most 20 valid mentions per comment');
  return { ids, handles };
}
