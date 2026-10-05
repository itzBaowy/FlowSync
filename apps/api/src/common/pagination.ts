export class PaginatedResult<T> {
  readonly meta: { page: number; limit: number; total: number; totalPages: number };
  constructor(
    readonly data: T[],
    page: number,
    limit: number,
    total: number,
  ) {
    this.meta = { page, limit, total, totalPages: Math.ceil(total / limit) };
  }
}
