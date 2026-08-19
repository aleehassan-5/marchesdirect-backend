// Augments Express's Request type with the custom `id` field
// set by the request-id tracking middleware in server.ts
declare namespace Express {
  export interface Request {
    id?: string;
  }
}
