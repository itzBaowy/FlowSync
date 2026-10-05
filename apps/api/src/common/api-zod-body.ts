import { ApiBody } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z } from 'zod';
export function ApiZodBody(schema: z.ZodType) {
  // Describe input, including transforms/defaults, from the same schema that validates requests.
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    io: 'input',
    target: 'openapi-3.0',
    unrepresentable: 'any',
  });
  return ApiBody({ schema: json as SchemaObject });
}
