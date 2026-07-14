import type { NetlifyJsonResponse } from './http.mts';

type NetlifyFunctionHeaders = Readonly<Record<string, string | undefined>>;
type NetlifyQueryStringParameters = Readonly<Record<string, string | undefined>>;

type NetlifyFunctionEvent = {
  httpMethod?: string;
  headers?: NetlifyFunctionHeaders | null;
  queryStringParameters?: NetlifyQueryStringParameters | null;
  body?: string | null;
};

type NetlifyFunctionHandler = (
  event: NetlifyFunctionEvent,
) => Promise<NetlifyJsonResponse>;

export type {
  NetlifyFunctionEvent,
  NetlifyFunctionHandler,
  NetlifyFunctionHeaders,
  NetlifyQueryStringParameters,
};
