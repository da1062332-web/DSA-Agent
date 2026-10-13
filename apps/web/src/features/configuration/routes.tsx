import type { RouteObject } from 'react-router-dom';
import { ConfigurationPage } from './ConfigurationPage';

export const routes: RouteObject[] = [
  {
    path: '/config',
    element: <ConfigurationPage />,
  },
];
