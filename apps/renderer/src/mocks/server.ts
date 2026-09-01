import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Node-side mock service, used by the component tests. */
export const server = setupServer(...handlers);
