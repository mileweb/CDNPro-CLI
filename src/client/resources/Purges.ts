import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class Purges {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/cdn/purges', { ...reqOptions, body });
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/purges', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(id: string, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/purges/${pathSegment(id, 'id')}`, reqOptions);
  }

  summary(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/purges/purgeSummary', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  tokens(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/purges/purgeTokens', { ...reqOptions, query: query as RequestOptions['query'] });
  }
}
