import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface PaginationMeta {
  page: number;
  limit: number;
  totalDocs: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ValidationErrorItem {
  field: string;
  message: string;
}

export type ApiSuccessResponse<TData> = {
  status: 'success';
  data: TData;
};

export type ApiErrorResponse<TErrors = null> = {
  status: 'error';
  message: string;
  code: string;
  errors: TErrors | null;
};

export const successResponse = <TData>(
  c: Context,
  data: TData,
  statusCode: ContentfulStatusCode = 200,
) => {
  return c.json<ApiSuccessResponse<TData>>(
    {
      status: 'success',
      data,
    },
    statusCode,
  );
};

export const createdResponse = <TData>(c: Context, data: TData) => {
  return successResponse(c, data, 201);
};

export const paginatedResponse = <TItem>(
  c: Context,
  items: TItem[],
  meta: PaginationMeta,
  statusCode: ContentfulStatusCode = 200,
) => {
  return successResponse(
    c,
    {
      items,
      meta,
    },
    statusCode,
  );
};

export const noContentResponse = (c: Context) => {
  return c.body(null, 204);
};

export const errorResponse = <TErrors = null>(
  c: Context,
  message: string,
  code: string,
  statusCode: ContentfulStatusCode,
  errors: TErrors | null = null,
) => {
  return c.json<ApiErrorResponse<TErrors>>(
    {
      status: 'error',
      message,
      code,
      errors,
    },
    statusCode,
  );
};
