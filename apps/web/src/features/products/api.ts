import { apiFetch } from '../../api/client';
import type {
  CreateProductInput,
  CreateProductVersionInput,
  LoanProduct,
  ProductStatus,
  ProductVersion,
} from './types';

export interface ListProductsResponse {
  data: LoanProduct[];
  meta: {
    nextCursor: string | null;
    limit: number;
  };
}

export async function fetchProducts(params?: {
  lenderId?: string;
  category?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<ListProductsResponse> {
  return apiFetch<ListProductsResponse>('/v1/products', {
    query: {
      lenderId: params?.lenderId,
      category: params?.category,
      status: params?.status,
      cursor: params?.cursor,
      limit: params?.limit,
    },
  });
}

export async function fetchProductById(id: string): Promise<LoanProduct> {
  return apiFetch<LoanProduct>(`/v1/products/${id}`);
}

export async function createProduct(input: CreateProductInput): Promise<LoanProduct> {
  return apiFetch<LoanProduct>('/v1/products', {
    method: 'POST',
    body: input,
  });
}

export async function createProductVersion(
  productId: string,
  input: CreateProductVersionInput,
): Promise<ProductVersion> {
  return apiFetch<ProductVersion>(`/v1/products/${productId}/versions`, {
    method: 'POST',
    body: input,
  });
}

export async function getProductVersion(versionId: string): Promise<ProductVersion> {
  return apiFetch<ProductVersion>(`/v1/product-versions/${versionId}`);
}

export async function updateProductStatus(
  productId: string,
  status: ProductStatus,
): Promise<{ id: string; status: ProductStatus }> {
  return apiFetch<{ id: string; status: ProductStatus }>(`/v1/products/${productId}/status`, {
    method: 'POST',
    body: { status },
  });
}
