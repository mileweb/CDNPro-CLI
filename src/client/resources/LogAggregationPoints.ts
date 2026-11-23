import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class LogAggregationPoints {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/logAggregationPoints', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(id: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/logAggregationPoints/${pathSegment(id, 'id')}`, reqOptions);
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/cdn/logAggregationPoints', { ...reqOptions, body });
  }

  update(id: string | number, patchBody: unknown, reqOptions: RequestOptions = {}) {
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/cdn/logAggregationPoints/${pathSegment(id, 'id')}`, { ...reqOptions, body: patchBody });
  }

  delete(id: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/cdn/logAggregationPoints/${pathSegment(id, 'id')}`, reqOptions);
  }

  summary(query: Record<string, unknown>, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/logAggregationPoints/summaryReport', { ...reqOptions, query: query as RequestOptions['query'] });
  }
}
