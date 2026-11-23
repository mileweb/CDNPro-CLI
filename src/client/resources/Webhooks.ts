import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class Webhooks {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/webhooks', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(id: string, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/webhooks/${pathSegment(id, 'id')}`, reqOptions);
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/cdn/webhooks', { ...reqOptions, body });
  }

  update(id: string, patchBody: unknown, reqOptions: RequestOptions = {}) {
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/cdn/webhooks/${pathSegment(id, 'id')}`, { ...reqOptions, body: patchBody });
  }

  delete(id: string, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/cdn/webhooks/${pathSegment(id, 'id')}`, reqOptions);
  }
}
