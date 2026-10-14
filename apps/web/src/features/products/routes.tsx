import type { RouteObject } from 'react-router-dom';
import { ProductCataloguePage } from './ProductCataloguePage';
import { ProductDetailPage } from './ProductDetailPage';

export const routes: RouteObject[] = [
  { path: '/products', element: <ProductCataloguePage /> },
  { path: '/products/:id', element: <ProductDetailPage /> },
];
